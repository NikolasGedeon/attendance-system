import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  private async validateUserLocation(
    userId: string,
    latitude?: number,
    longitude?: number,
  ) {
    if (latitude === undefined || longitude === undefined) {
      throw new BadRequestException(
        'Location is required. Please enable GPS/location before clocking in.',
      );
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
      throw new BadRequestException(
        'You are not assigned to a work location. Please contact admin.',
      );
    }

    if (!user.location.isActive) {
      throw new BadRequestException(
        'Your assigned work location is inactive. Please contact admin.',
      );
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

    const attendance = await this.prisma.attendance.create({
      data: {
        userId,
        clockIn: new Date(),
        latitude,
        longitude,
      },
    });

    return {
      ...this.formatAttendanceRecord(attendance),
      locationValidation,
    };
  }

  async clockOut(userId: string) {
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

    const updated = await this.prisma.attendance.update({
      where: {
        id: openAttendance.id,
      },
      data: {
        clockOut: new Date(),
      },
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
