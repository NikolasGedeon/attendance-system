import { Injectable } from '@nestjs/common';
import { AttendanceOtpAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Central rules for kiosk clock ATTEMPTS and the manager clock-in override
 * eligibility. Kept in one place so every clocking flow (card, OTP,
 * mobile-token, kiosk-QR, mobile GPS) and the manager module agree on:
 *
 *   A manager clock-in override becomes available only when an employee has
 *   >= THRESHOLD failed CLOCK_IN attempts, within WINDOW_MINUTES, at the SAME
 *   location, none of which has been resolved by a later successful clock-in.
 *
 * A failed CLOCK_OUT never counts. A successful clock-in (any method) resolves
 * the whole outstanding failed-CLOCK_IN sequence so it can never be reused.
 */
export const FAILED_CLOCK_IN_WINDOW_MINUTES = 15;
export const FAILED_CLOCK_IN_THRESHOLD = 3;

type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ClockAttemptService {
  constructor(private readonly prisma: PrismaService) {}

  private windowStart(now: Date = new Date()): Date {
    return new Date(now.getTime() - FAILED_CLOCK_IN_WINDOW_MINUTES * 60 * 1000);
  }

  /** Record a FAILED CLOCK_IN attempt (the only kind that qualifies). */
  async recordFailedClockIn(
    params: {
      userId: string;
      kioskId?: string | null;
      locationId?: string | null;
      reason?: string | null;
    },
    client: PrismaLike = this.prisma,
  ) {
    return client.clockAttempt.create({
      data: {
        userId: params.userId,
        kioskId: params.kioskId ?? null,
        locationId: params.locationId ?? null,
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
        reason: params.reason ?? null,
      },
    });
  }

  /**
   * Mark every outstanding (unresolved) failed CLOCK_IN attempt for a user as
   * resolved. Called after ANY successful clock-in and after a manager
   * override so a sequence can never be reused.
   */
  async resolveFailedClockIns(
    userId: string,
    resolvedById: string | null,
    client: PrismaLike = this.prisma,
  ) {
    return client.clockAttempt.updateMany({
      where: {
        userId,
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
        resolvedAt: null,
      },
      data: {
        resolvedAt: new Date(),
        resolvedById,
      },
    });
  }

  /**
   * Outstanding failed CLOCK_IN attempts for a user within the window,
   * newest first. Includes location/kiosk names for display. Optionally
   * scoped to a single location.
   */
  async listQualifyingFailedClockIns(
    userId: string,
    locationId?: string | null,
    client: PrismaLike = this.prisma,
  ) {
    return client.clockAttempt.findMany({
      where: {
        userId,
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
        resolvedAt: null,
        attemptedAt: { gte: this.windowStart() },
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { attemptedAt: 'desc' },
      include: {
        location: { select: { id: true, name: true } },
        kiosk: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Group a user's outstanding failed CLOCK_IN attempts by location and return
   * only the locations that meet the threshold. This is the server-side source
   * of truth for `managerClockInAvailable` and for the override location.
   */
  async getQualifyingLocations(
    userId: string,
    client: PrismaLike = this.prisma,
  ): Promise<Array<{ locationId: string; attemptIds: string[]; count: number }>> {
    const rows = await this.listQualifyingFailedClockIns(userId, null, client);
    const byLocation = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.locationId) continue;
      const list = byLocation.get(row.locationId) ?? [];
      list.push(row.id);
      byLocation.set(row.locationId, list);
    }
    return Array.from(byLocation.entries())
      .filter(([, ids]) => ids.length >= FAILED_CLOCK_IN_THRESHOLD)
      .map(([locationId, attemptIds]) => ({
        locationId,
        attemptIds,
        count: attemptIds.length,
      }));
  }
}
