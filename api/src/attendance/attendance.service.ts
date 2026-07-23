import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockOutDto } from './dto/clock-out.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private getHoursOpen(clockIn: Date) {
    const now = new Date();
    return (now.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
  }

  private getDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const earthRadiusMeters = 6371000;

    const toRadians = (degrees: number) => {
      return degrees * (Math.PI / 180);
    };

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
  }

  private formatAttendanceRecord(record: any) {
    let workedMinutes: number | null = null;
    let workedHours: number | null = null;

    if (record.clockIn && record.clockOut) {
      const diffMs =
        new Date(record.clockOut).getTime() -
        new Date(record.clockIn).getTime();

      workedMinutes = Math.floor(diffMs / (1000 * 60));
      workedHours = Number((workedMinutes / 60).toFixed(2));
    }

    return {
      ...record,
      workedMinutes,
      workedHours,
    };
  }

  /**
   * Shared geofence validation used by BOTH mobile clock-in and clock-out.
   * Throws BadRequestException with a stable machine-readable `code`.
   * Behaviour is unchanged for clock-in (same checks/order); only a `code`
   * field and an explicit coordinate-range check were added.
   */
  private async validateUserLocation(
    userId: string,
    latitude?: number,
    longitude?: number,
  ) {
    if (
      latitude === undefined ||
      latitude === null ||
      longitude === undefined ||
      longitude === null
    ) {
      throw new BadRequestException({
        code: 'LOCATION_REQUIRED',
        message:
          'Location is required. Please enable GPS/location before clocking in or out.',
      });
    }

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new BadRequestException({
        code: 'LOCATION_INVALID',
        message: 'The provided location coordinates are invalid.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        location: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.location) {
      throw new BadRequestException({
        code: 'NO_ASSIGNED_LOCATION',
        message:
          'You are not assigned to a work location. Please contact admin.',
      });
    }

    if (!user.location.isActive) {
      throw new BadRequestException({
        code: 'LOCATION_INACTIVE',
        message:
          'Your assigned work location is inactive. Please contact admin.',
      });
    }

    const distanceMeters = this.getDistanceMeters(
      latitude,
      longitude,
      user.location.latitude,
      user.location.longitude,
    );

    const roundedDistanceMeters = Math.round(distanceMeters);

    if (distanceMeters > user.location.radiusMeters) {
      throw new BadRequestException({
        code: 'LOCATION_OUTSIDE_GEOFENCE',
        message: 'You are not inside your assigned work location.',
        assignedLocation: {
          id: user.location.id,
          name: user.location.name,
          latitude: user.location.latitude,
          longitude: user.location.longitude,
          radiusMeters: user.location.radiusMeters,
        },
        yourLocation: {
          latitude,
          longitude,
        },
        distanceMeters: roundedDistanceMeters,
        allowedRadiusMeters: user.location.radiusMeters,
      });
    }

    return {
      assignedLocation: user.location,
      distanceMeters: roundedDistanceMeters,
    };
  }

  /**
   * Validate the GPS-fix freshness for a mobile clock-out.
   * Returns the parsed fix time (or undefined if none supplied). The official
   * clock-out time is ALWAYS the server clock, never this value.
   */
  private validateFixFreshness(capturedAt?: string): Date | undefined {
    if (!capturedAt) return undefined;

    const captured = new Date(capturedAt);
    if (Number.isNaN(captured.getTime())) {
      throw new BadRequestException({
        code: 'LOCATION_INVALID',
        message: 'The location timestamp is invalid.',
      });
    }

    const maxAgeSeconds = Number(
      process.env.CLOCK_LOCATION_MAX_AGE_SECONDS ?? 120,
    );
    const futureSkewSeconds = 30;
    const ageSeconds = (Date.now() - captured.getTime()) / 1000;

    if (ageSeconds > maxAgeSeconds) {
      throw new BadRequestException({
        code: 'LOCATION_TOO_OLD',
        message:
          'Your location is out of date. Please try clocking out again.',
      });
    }
    if (ageSeconds < -futureSkewSeconds) {
      throw new BadRequestException({
        code: 'LOCATION_TIMESTAMP_IN_FUTURE',
        message: 'Your device clock appears to be ahead. Please check the time.',
      });
    }
    return captured;
  }

  async clockIn(userId: string, latitude?: number, longitude?: number) {
    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (openAttendance) {
      const hoursOpen = this.getHoursOpen(openAttendance.clockIn);

      if (hoursOpen >= 20) {
        throw new BadRequestException({
          message:
            'You are still clocked in for more than 20 hours. You must clock out before clocking in again.',
          forceClockOut: true,
          isClockedIn: true,
          hoursOpen: Number(hoursOpen.toFixed(2)),
          attendance: openAttendance,
        });
      }

      throw new BadRequestException({
        message: 'You are still clocked in. Please clock out first.',
        forceClockOut: false,
        isClockedIn: true,
        hoursOpen: Number(hoursOpen.toFixed(2)),
        attendance: openAttendance,
      });
    }

    const locationValidation = await this.validateUserLocation(
      userId,
      latitude,
      longitude,
    );

    let attendance;
    try {
      attendance = await this.prisma.attendance.create({
        data: {
          userId,
          clockIn: new Date(),
          latitude,
          longitude,
        },
      });
    } catch (error) {
      // Partial unique index "Attendance_one_open_per_user": a concurrent
      // request (any method) already opened a record. Deterministic conflict
      // instead of a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You were just clocked in by another action. Refresh your status.',
        );
      }
      throw error;
    }

    return {
      ...this.formatAttendanceRecord(attendance),
      locationValidation,
    };
  }

  /**
   * Mobile employee clock-out (POST /attendance/clock-out).
   *
   * Geolocation is enforced unless REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION="false"
   * (rollout escape hatch only — the intended production value is unset/true).
   * Kiosk/card/QR clock-outs use their own services and are unaffected.
   */
  async clockOut(userId: string, dto: ClockOutDto = {}) {
    const enforceGeolocation =
      process.env.REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION !== 'false';

    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openAttendance) {
      throw new NotFoundException('No active clock-in record found');
    }

    // Clock-out geolocation fields (only populated when enforcement is on).
    // Cast at the call site because the generated Prisma client only exposes
    // these columns AFTER `npx prisma generate` is run against the new schema.
    let clockOutGeo: Record<string, unknown> = {};

    if (enforceGeolocation) {
      const capturedAt = this.validateFixFreshness(dto.capturedAt);
      const { assignedLocation } = await this.validateUserLocation(
        userId,
        dto.latitude,
        dto.longitude,
      );

      clockOutGeo = {
        clockOutLatitude: dto.latitude,
        clockOutLongitude: dto.longitude,
        clockOutAccuracyMeters: dto.accuracyMeters ?? null,
        clockOutLocationId: assignedLocation.id,
        clockOutGeofenceStatus: 'INSIDE',
        clockOutCapturedAt: capturedAt ?? null,
      };
    }

    const updated = await this.prisma.attendance.update({
      where: {
        id: openAttendance.id,
      },
      // `clockOut` is ALWAYS the server clock — never the phone-supplied time.
      data: {
        clockOut: new Date(),
        ...clockOutGeo,
      } as unknown as Prisma.AttendanceUpdateInput,
    });

    return this.formatAttendanceRecord(updated);
  }

  async getMyAttendance(userId: string) {
    const records = await this.prisma.attendance.findMany({
      where: {
        userId,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    return records.map((record) => this.formatAttendanceRecord(record));
  }

  async getStatus(userId: string) {
    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openAttendance) {
      return {
        isClockedIn: false,
        forceClockOut: false,
        canClockIn: true,
        message: 'You are not clocked in.',
        attendance: null,
      };
    }

    const hoursOpen = this.getHoursOpen(openAttendance.clockIn);
    const forceClockOut = hoursOpen >= 20;

    return {
      isClockedIn: true,
      forceClockOut,
      canClockIn: false,
      hoursOpen: Number(hoursOpen.toFixed(2)),
      message: forceClockOut
        ? 'You have been clocked in for more than 20 hours. You must clock out before clocking in again.'
        : 'You are still clocked in. Please clock out before clocking in again.',
      attendance: openAttendance,
    };
  }

  async getAllAttendance(filters: {
    userId?: string;
    from?: string;
    to?: string;
  }) {
    const { userId, from, to } = filters;

    const records = await this.prisma.attendance.findMany({
      where: {
        ...(userId && { userId }),
        ...(from || to
          ? {
              clockIn: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            location: true,
          },
        },
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    return records.map((record) => this.formatAttendanceRecord(record));
  }

  async updateAttendance(
    id: string,
    changedById: string,
    data: {
      clockIn?: string;
      clockOut?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      reason?: string;
    },
  ) {
    const reason = data.reason?.trim();

    if (!reason || reason.length < 3) {
      throw new BadRequestException('Reason is required for attendance changes');
    }

    const attendance = await this.prisma.attendance.findUnique({
      where: { id },
    });

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    const newClockIn =
      data.clockIn !== undefined ? new Date(data.clockIn) : attendance.clockIn;

    const newClockOut =
      data.clockOut !== undefined
        ? data.clockOut
          ? new Date(data.clockOut)
          : null
        : attendance.clockOut;

    const newLatitude =
      data.latitude !== undefined ? data.latitude : attendance.latitude;

    const newLongitude =
      data.longitude !== undefined ? data.longitude : attendance.longitude;

    if (newClockOut && newClockOut <= newClockIn) {
      throw new BadRequestException('Clock out must be after clock in');
    }

    const isSameClockIn =
      newClockIn.getTime() === attendance.clockIn.getTime();

    const isSameClockOut =
      newClockOut?.getTime() === attendance.clockOut?.getTime();

    const isSameLatitude = newLatitude === attendance.latitude;
    const isSameLongitude = newLongitude === attendance.longitude;

    if (
      isSameClockIn &&
      isSameClockOut &&
      isSameLatitude &&
      isSameLongitude
    ) {
      throw new BadRequestException('No attendance changes detected');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedAttendance = await tx.attendance.update({
        where: { id },
        data: {
          clockIn: newClockIn,
          clockOut: newClockOut,
          latitude: newLatitude,
          longitude: newLongitude,
        },
      });

      await tx.attendanceAdjustmentLog.create({
        data: {
          attendanceId: id,
          changedById,

          oldClockIn: attendance.clockIn,
          oldClockOut: attendance.clockOut,
          newClockIn,
          newClockOut,

          oldLatitude: attendance.latitude,
          oldLongitude: attendance.longitude,
          newLatitude,
          newLongitude,

          reason,
        },
      });

      return updatedAttendance;
    });

    return this.formatAttendanceRecord(updated);
  }

  async getAttendanceAdjustments(id: string) {
    return this.prisma.attendanceAdjustmentLog.findMany({
      where: {
        attendanceId: id,
      },
      include: {
        changedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getMonthlyReport(year: number, month: number) {
    if (!year || !month || month < 1 || month > 12) {
      throw new BadRequestException('Valid year and month are required');
    }

    const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const records = await this.prisma.attendance.findMany({
      where: {
        clockIn: {
          gte: from,
          lt: to,
        },
        clockOut: {
          not: null,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            location: true,
          },
        },
      },
      orderBy: {
        clockIn: 'asc',
      },
    });

    const reportMap = new Map<
      string,
      {
        userId: string;
        fullName: string;
        email: string | null;
        role: string;
        location: any;
        totalMinutes: number;
        totalHours: number;
        recordsCount: number;
      }
    >();

    for (const record of records) {
      if (!record.clockOut) {
        continue;
      }

      const workedMinutes = Math.floor(
        (record.clockOut.getTime() - record.clockIn.getTime()) / (1000 * 60),
      );

      const existing = reportMap.get(record.userId);

      if (existing) {
        existing.totalMinutes += workedMinutes;
        existing.totalHours = Number((existing.totalMinutes / 60).toFixed(2));
        existing.recordsCount += 1;
      } else {
        reportMap.set(record.userId, {
          userId: record.userId,
          fullName: record.user.fullName,
          email: record.user.email,
          role: record.user.role,
          location: record.user.location,
          totalMinutes: workedMinutes,
          totalHours: Number((workedMinutes / 60).toFixed(2)),
          recordsCount: 1,
        });
      }
    }

    return Array.from(reportMap.values()).sort(
      (a, b) => b.totalMinutes - a.totalMinutes,
    );
  }

  async getDailyReport(date: string) {
    if (!date) {
      throw new BadRequestException('Date is required');
    }

    const selectedDate = new Date(date);

    if (isNaN(selectedDate.getTime())) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    const year = selectedDate.getUTCFullYear();
    const month = selectedDate.getUTCMonth();
    const day = selectedDate.getUTCDate();

    const from = new Date(Date.UTC(year, month, day, 0, 0, 0));
    const to = new Date(Date.UTC(year, month, day + 1, 0, 0, 0));

    const records = await this.prisma.attendance.findMany({
      where: {
        clockIn: {
          gte: from,
          lt: to,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            location: true,
          },
        },
      },
      orderBy: {
        clockIn: 'asc',
      },
    });

    const formattedRecords = records.map((record) =>
      this.formatAttendanceRecord(record),
    );

    const uniqueEmployees = new Set(records.map((record) => record.userId));

    const currentlyClockedIn = records.filter(
      (record) => record.clockOut === null,
    ).length;

    const totalWorkedMinutes = formattedRecords.reduce((total, record) => {
      return total + (record.workedMinutes ?? 0);
    }, 0);

    return {
      date,
      from,
      to,
      totalEmployeesClockedIn: uniqueEmployees.size,
      currentlyClockedIn,
      totalRecords: records.length,
      totalWorkedMinutes,
      totalWorkedHours: Number((totalWorkedMinutes / 60).toFixed(2)),
      records: formattedRecords,
    };
  }
}
