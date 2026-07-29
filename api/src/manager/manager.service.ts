import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceMethod, Prisma, Role } from '@prisma/client';
import {
  ClockAttemptService,
  FAILED_CLOCK_IN_THRESHOLD,
  FAILED_CLOCK_IN_WINDOW_MINUTES,
} from '../clock-attempt/clock-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerClockInDto } from './dto/manager-clock-in.dto';

/**
 * Manager live attendance + limited clock-in override.
 *
 * Scope model (per project decision): a manager manages exactly their own
 * assigned location (User.locationId). A manager sees an employee if the
 * employee is ASSIGNED to that location OR is CURRENTLY clocked in there.
 * ADMIN sees everyone / all locations. All scope + eligibility is enforced
 * here server-side; the Flutter client is never trusted.
 */
type ManagerContext = { id: string; role: Role; locationId: string | null };

@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clockAttempts: ClockAttemptService,
  ) {}

  private windowStart(): Date {
    return new Date(Date.now() - FAILED_CLOCK_IN_WINDOW_MINUTES * 60 * 1000);
  }

  /** Load the acting manager's fresh role + assigned location. */
  private async getManagerContext(managerId: string): Promise<ManagerContext> {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, role: true, locationId: true },
    });
    if (!manager) {
      throw new NotFoundException('Manager account not found');
    }
    if (manager.role !== Role.MANAGER && manager.role !== Role.ADMIN) {
      throw new ForbiddenException('Manager or admin role required');
    }
    return manager;
  }

  /** User ids the manager is authorized to see. */
  private async getScopedUserIds(ctx: ManagerContext): Promise<string[]> {
    if (ctx.role === Role.ADMIN) {
      const all = await this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return all.map((u) => u.id);
    }

    // MANAGER: employees assigned to their location OR currently clocked in there.
    if (!ctx.locationId) return [];

    const [assigned, openHere] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, locationId: ctx.locationId },
        select: { id: true },
      }),
      this.prisma.attendance.findMany({
        where: { clockOut: null, clockInLocationId: ctx.locationId },
        select: { userId: true },
      }),
    ]);

    const ids = new Set<string>();
    assigned.forEach((u) => ids.add(u.id));
    openHere.forEach((a) => ids.add(a.userId));
    return Array.from(ids);
  }

  /**
   * Map of userId -> (locationId -> unresolved recent failed CLOCK_IN count)
   * for the given users, computed in a single query.
   */
  private async getFailedCountsByUser(
    userIds: string[],
  ): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();
    if (userIds.length === 0) return result;

    const attempts = await this.prisma.clockAttempt.findMany({
      where: {
        userId: { in: userIds },
        action: 'CLOCK_IN',
        successful: false,
        resolvedAt: null,
        attemptedAt: { gte: this.windowStart() },
      },
      select: { userId: true, locationId: true },
    });

    for (const a of attempts) {
      if (!a.locationId) continue;
      const byLoc = result.get(a.userId) ?? new Map<string, number>();
      byLoc.set(a.locationId, (byLoc.get(a.locationId) ?? 0) + 1);
      result.set(a.userId, byLoc);
    }
    return result;
  }

  async getLiveAttendance(managerId: string) {
    const ctx = await this.getManagerContext(managerId);
    const userIds = await this.getScopedUserIds(ctx);

    if (userIds.length === 0) {
      return { managedLocationId: ctx.locationId, employees: [] };
    }

    // Latest attendance record per employee (one query via distinct).
    const latest = await this.prisma.attendance.findMany({
      where: { userId: { in: userIds } },
      orderBy: [{ userId: 'asc' }, { clockIn: 'desc' }],
      distinct: ['userId'],
      include: {
        clockInLocation: { select: { id: true, name: true } },
        clockOutLocation: { select: { id: true, name: true } },
        kioskIn: { select: { id: true, name: true } },
        kioskOut: { select: { id: true, name: true } },
      },
    });
    const latestByUser = new Map(latest.map((a) => [a.userId, a]));

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        fullName: true,
        location: { select: { id: true, name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    const failedCounts = await this.getFailedCountsByUser(userIds);

    const employees = users.map((u) => {
      const a = latestByUser.get(u.id);
      const isClockedIn = !!a && a.clockOut === null;

      const byLoc = failedCounts.get(u.id) ?? new Map<string, number>();
      // Authority locations for this actor.
      const authority =
        ctx.role === Role.ADMIN
          ? Array.from(byLoc.keys())
          : ctx.locationId
            ? [ctx.locationId]
            : [];

      // Eligible = an authority location that meets the threshold.
      const eligibleLocationId =
        authority.find(
          (loc) => (byLoc.get(loc) ?? 0) >= FAILED_CLOCK_IN_THRESHOLD,
        ) ?? null;

      // Display count: for a manager, at their location; for admin, the
      // strongest single-location signal.
      const failedClockInAttempts =
        ctx.role === Role.ADMIN
          ? Math.max(0, ...Array.from(byLoc.values()))
          : ctx.locationId
            ? (byLoc.get(ctx.locationId) ?? 0)
            : 0;

      const managerClockInAvailable = !isClockedIn && eligibleLocationId !== null;

      return {
        employeeId: u.id,
        employeeName: u.fullName,
        assignedLocation: u.location
          ? { id: u.location.id, name: u.location.name }
          : null,
        currentStatus: a
          ? isClockedIn
            ? 'CLOCKED_IN'
            : 'CLOCKED_OUT'
          : 'NEVER',
        attendanceId: a?.id ?? null,
        clockInTime: a?.clockIn ?? null,
        clockOutTime: a?.clockOut ?? null,
        actualClockInLocation: a?.clockInLocation?.name ?? null,
        actualClockOutLocation: a?.clockOutLocation?.name ?? null,
        clockInMethod: a?.methodIn ?? null,
        clockOutMethod: a?.methodOut ?? null,
        clockInKiosk: a?.kioskIn?.name ?? null,
        clockOutKiosk: a?.kioskOut?.name ?? null,
        failedClockInAttempts,
        managerClockInAvailable,
      };
    });

    return { managedLocationId: ctx.locationId, employees };
  }

  /** Outstanding qualifying failed CLOCK_IN sequences within the manager scope. */
  async getFailedClockAttempts(managerId: string) {
    const ctx = await this.getManagerContext(managerId);
    const userIds = await this.getScopedUserIds(ctx);
    if (userIds.length === 0) return { attempts: [] };

    const attempts = await this.prisma.clockAttempt.findMany({
      where: {
        userId: { in: userIds },
        action: 'CLOCK_IN',
        successful: false,
        resolvedAt: null,
        attemptedAt: { gte: this.windowStart() },
        ...(ctx.role === Role.ADMIN ? {} : { locationId: ctx.locationId }),
      },
      orderBy: { attemptedAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true } },
        location: { select: { id: true, name: true } },
        kiosk: { select: { id: true, name: true } },
      },
    });

    return {
      attempts: attempts.map((a) => ({
        id: a.id,
        employeeId: a.userId,
        employeeName: a.user.fullName,
        location: a.location?.name ?? null,
        kiosk: a.kiosk?.name ?? null,
        reason: a.reason,
        attemptedAt: a.attemptedAt,
      })),
    };
  }

  async managerClockIn(
    managerId: string,
    employeeId: string,
    dto: ManagerClockInDto,
  ) {
    const ctx = await this.getManagerContext(managerId);

    const reason = dto.reason?.trim();
    if (!reason || reason.length < 3) {
      throw new BadRequestException('A reason is required for a manager clock-in');
    }

    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: { id: true, isActive: true, locationId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (!employee.isActive) {
      throw new BadRequestException('Employee is inactive');
    }

    // Already clocked in? Reject up front (also guarded in the transaction).
    const open = await this.prisma.attendance.findFirst({
      where: { userId: employeeId, clockOut: null },
    });
    if (open) {
      throw new ConflictException('Employee is already clocked in');
    }

    // Determine the qualifying location within the manager's authority.
    const qualifying = await this.clockAttempts.getQualifyingLocations(
      employeeId,
    );
    const authority =
      ctx.role === Role.ADMIN
        ? qualifying.map((q) => q.locationId)
        : ctx.locationId
          ? [ctx.locationId]
          : [];

    const eligible = qualifying.find((q) => authority.includes(q.locationId));
    if (!eligible) {
      throw new ForbiddenException(
        `No qualifying failed-attempt sequence (>= ${FAILED_CLOCK_IN_THRESHOLD} within ${FAILED_CLOCK_IN_WINDOW_MINUTES} minutes) at a location you manage.`,
      );
    }

    // Transaction: create the override attendance, resolve the attempt
    // sequence, and write the permanent audit atomically.
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Re-verify inside the transaction (defends against a concurrent
        // successful clock-in or a second manager resolving the sequence).
        const stillQualifying = await this.clockAttempts.getQualifyingLocations(
          employeeId,
          tx,
        );
        const stillEligible = stillQualifying.find(
          (q) => q.locationId === eligible.locationId,
        );
        if (!stillEligible) {
          throw new ConflictException(
            'The failed-attempt sequence was already resolved. Refresh and try again.',
          );
        }

        const attendance = await tx.attendance.create({
          data: {
            userId: employeeId,
            clockIn: new Date(),
            methodIn: AttendanceMethod.MANAGER_OVERRIDE,
            clockInLocationId: eligible.locationId,
            notes: `Manager override: ${reason}`,
            isEdited: true,
          },
        });

        await this.clockAttempts.resolveFailedClockIns(
          employeeId,
          attendance.id,
          tx,
        );

        await tx.managerOverrideAudit.create({
          data: {
            employeeId,
            managerId: ctx.id,
            attendanceId: attendance.id,
            locationId: eligible.locationId,
            reason,
            qualifyingFailedAttempts: stillEligible.count,
            failedAttemptIds: stillEligible.attemptIds as Prisma.InputJsonValue,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: ctx.id,
            action: 'MANAGER_CLOCK_IN_OVERRIDE',
            entityType: 'Attendance',
            entityId: attendance.id,
            metadata: {
              employeeId,
              locationId: eligible.locationId,
              qualifyingFailedAttempts: stillEligible.count,
            },
          },
        });

        return attendance;
      });
    } catch (error) {
      // Partial unique index "Attendance_one_open_per_user": another flow
      // opened a record first (e.g. a second manager or a kiosk).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Employee was just clocked in by another action. Refresh the list.',
        );
      }
      throw error;
    }

    return {
      success: true,
      attendanceId: created.id,
      employeeId,
      clockIn: created.clockIn,
      method: created.methodIn,
      locationId: eligible.locationId,
      qualifyingFailedAttempts: eligible.count,
    };
  }
}
