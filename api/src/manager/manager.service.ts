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
import { REPORT_TZ, cyprusTime } from '../attendance/report-policy.util';
import { ManagerClockInDto } from './dto/manager-clock-in.dto';

/** Filters accepted by the live dashboard. Company is the primary filter. */
export interface LiveDashboardFilters {
  companyId?: string;
  locationId?: string;
  type?: string; // ALL | CLOCK_IN | CLOCK_OUT
  method?: string;
  search?: string;
}

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

  /** [start, end) UTC instants for the Cyprus business day containing `now`. */
  private cyprusDayBounds(now: Date = new Date()): { start: Date; end: Date } {
    const dayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: REPORT_TZ,
    }).format(now); // YYYY-MM-DD
    // DST-correct offset of REPORT_TZ for this instant.
    const asUtc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const asTz = new Date(now.toLocaleString('en-US', { timeZone: REPORT_TZ }));
    const offsetMs = asTz.getTime() - asUtc.getTime();
    const [y, m, d] = dayStr.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
    return { start: new Date(startMs), end: new Date(startMs + 86400000) };
  }

  private effectiveCompany(row: any): { id: string; name: string } | null {
    if (row.companyId) {
      return { id: row.companyId, name: row.company?.name ?? 'Company' };
    }
    // Legacy fallback: use the user's CURRENT company (display only).
    if (row.user?.companyId) {
      return {
        id: row.user.companyId,
        name: row.user.company?.name ?? 'Company',
      };
    }
    return null;
  }

  /**
   * Optimized Live Attendance dashboard. Returns compact KPI totals, per-company
   * totals (computed independently of the selected company so the guard can
   * switch), the latest event, and a newest-first chronological event feed for
   * today. KPI totals + feed reflect the active filters; company chips do not
   * apply the company/location/type/method/search selection.
   */
  async getLiveDashboard(managerId: string, filters: LiveDashboardFilters) {
    const ctx = await this.getManagerContext(managerId);
    const { start, end } = this.cyprusDayBounds();

    // Scope: ADMIN sees everyone; MANAGER only their location's users.
    const scopeWhere: Prisma.AttendanceWhereInput =
      ctx.role === Role.ADMIN
        ? {}
        : { userId: { in: await this.getScopedUserIds(ctx) } };

    const include = {
      user: {
        select: {
          id: true,
          fullName: true,
          companyId: true,
          company: { select: { id: true, name: true } },
        },
      },
      company: { select: { id: true, name: true } },
      clockInLocation: { select: { id: true, name: true } },
      clockOutLocation: { select: { id: true, name: true } },
      kioskIn: { select: { id: true, name: true } },
      kioskOut: { select: { id: true, name: true } },
    } as const;

    // Rows with a clock-in OR clock-out that falls in today, plus all open
    // records (needed for Active Now even if opened on a previous day).
    const [todayRows, openRows] = await Promise.all([
      this.prisma.attendance.findMany({
        where: {
          ...scopeWhere,
          OR: [
            { clockIn: { gte: start, lt: end } },
            { clockOut: { gte: start, lt: end } },
          ],
        },
        include,
        orderBy: { clockIn: 'desc' },
      }),
      this.prisma.attendance.findMany({
        where: { ...scopeWhere, clockOut: null },
        include,
      }),
    ]);

    // ---- Expand today's rows into chronological events ----
    type Ev = {
      attendanceId: string;
      employeeId: string;
      employeeName: string;
      type: 'CLOCK_IN' | 'CLOCK_OUT';
      time: Date;
      companyId: string | null;
      companyName: string | null;
      location: string | null;
      method: string | null;
      kiosk: string | null;
    };
    const events: Ev[] = [];
    for (const r of todayRows) {
      const company = this.effectiveCompany(r);
      if (r.clockIn >= start && r.clockIn < end) {
        events.push({
          attendanceId: r.id,
          employeeId: r.userId,
          employeeName: r.user.fullName,
          type: 'CLOCK_IN',
          time: r.clockIn,
          companyId: company?.id ?? null,
          companyName: company?.name ?? null,
          location: r.clockInLocation?.name ?? null,
          method: r.methodIn ?? null,
          kiosk: r.kioskIn?.name ?? null,
        });
      }
      if (r.clockOut && r.clockOut >= start && r.clockOut < end) {
        events.push({
          attendanceId: r.id,
          employeeId: r.userId,
          employeeName: r.user.fullName,
          type: 'CLOCK_OUT',
          time: r.clockOut,
          companyId: company?.id ?? null,
          companyName: company?.name ?? null,
          location: r.clockOutLocation?.name ?? null,
          method: r.methodOut ?? null,
          kiosk: r.kioskOut?.name ?? null,
        });
      }
    }
    events.sort((a, b) => b.time.getTime() - a.time.getTime());

    // ---- Company chips: independent of company/location/type/method/search ----
    const chip = new Map<
      string,
      { companyId: string; companyName: string; todayUsers: Set<string>; activeNow: number }
    >();
    for (const e of events) {
      if (!e.companyId) continue;
      const c = chip.get(e.companyId) ?? {
        companyId: e.companyId,
        companyName: e.companyName ?? 'Company',
        todayUsers: new Set<string>(),
        activeNow: 0,
      };
      c.todayUsers.add(e.employeeId);
      chip.set(e.companyId, c);
    }
    for (const r of openRows) {
      const company = this.effectiveCompany(r);
      if (!company) continue;
      const c = chip.get(company.id) ?? {
        companyId: company.id,
        companyName: company.name,
        todayUsers: new Set<string>(),
        activeNow: 0,
      };
      c.activeNow += 1;
      chip.set(company.id, c);
    }
    const companies = Array.from(chip.values())
      .map((c) => ({
        companyId: c.companyId,
        companyName: c.companyName,
        activeNow: c.activeNow,
        totalToday: c.todayUsers.size,
      }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    // ---- Apply active filters to the feed + KPI totals ----
    const q = filters.search?.trim().toLowerCase();
    const typeF = (filters.type ?? 'ALL').toUpperCase();
    const matchEvent = (e: Ev) =>
      (!filters.companyId || e.companyId === filters.companyId) &&
      (typeF === 'ALL' || e.type === typeF) &&
      (!filters.method || e.method === filters.method) &&
      (!q || e.employeeName.toLowerCase().includes(q));

    // Location filter needs the id, not the name — recompute per event using
    // the source row's location ids.
    const rowLocIn = new Map(todayRows.map((r) => [r.id + ':CLOCK_IN', r.clockInLocationId]));
    const rowLocOut = new Map(todayRows.map((r) => [r.id + ':CLOCK_OUT', r.clockOutLocationId]));
    const matchesLocation = (e: Ev) => {
      if (!filters.locationId) return true;
      const locId =
        e.type === 'CLOCK_IN'
          ? rowLocIn.get(e.attendanceId + ':CLOCK_IN')
          : rowLocOut.get(e.attendanceId + ':CLOCK_OUT');
      return locId === filters.locationId;
    };

    const filtered = events.filter((e) => matchEvent(e) && matchesLocation(e));

    const clockInsToday = filtered.filter((e) => e.type === 'CLOCK_IN').length;
    const clockOutsToday = filtered.filter((e) => e.type === 'CLOCK_OUT').length;
    const totalToday = new Set(filtered.map((e) => e.employeeId)).size;

    // Active Now = open records, filtered by company/location where selected.
    const activeNow = openRows.filter((r) => {
      const company = this.effectiveCompany(r);
      if (filters.companyId && company?.id !== filters.companyId) return false;
      if (filters.locationId && r.clockInLocationId !== filters.locationId) {
        return false;
      }
      return true;
    }).length;

    const toWire = (e: Ev) => ({
      attendanceId: e.attendanceId,
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      type: e.type,
      time: e.time,
      timeLabel: cyprusTime(e.time),
      companyId: e.companyId,
      companyName: e.companyName,
      location: e.location,
      method: e.method,
      kiosk: e.kiosk,
    });

    return {
      summary: { activeNow, totalToday, clockInsToday, clockOutsToday },
      companies,
      latestEvent: filtered.length ? toWire(filtered[0]) : null,
      events: filtered.slice(0, 200).map(toWire),
      lastUpdatedAt: new Date().toISOString(),
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
      select: { id: true, isActive: true, locationId: true, companyId: true },
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
            // Historical company snapshot (employee's company at clock-in).
            companyId: employee.companyId ?? null,
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
