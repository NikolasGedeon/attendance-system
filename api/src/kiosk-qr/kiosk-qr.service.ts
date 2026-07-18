import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttendanceMethod,
  AttendanceOtpAction,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kiosk-displayed QR clocking:
 * the kiosk shows a short-lived QR (opaque random token, hash stored),
 * the employee phone scans it and consumes it with the employee JWT.
 * The server decides clock-in vs clock-out from the current open record.
 */
const CHALLENGE_TTL_SECONDS = 25;

@Injectable()
export class KioskQrService {
  constructor(private readonly prisma: PrismaService) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async getActiveKiosk(kioskDeviceKey: string) {
    const deviceKey = kioskDeviceKey.trim();

    const kiosk = await this.prisma.kiosk.findUnique({
      where: { deviceKey },
    });

    if (!kiosk || !kiosk.isActive) {
      throw new UnauthorizedException('Invalid or inactive kiosk');
    }

    return this.prisma.kiosk.update({
      where: { id: kiosk.id },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Creates (and replaces) the single active challenge for a kiosk.
   * The raw token is returned exactly once; only its hash is stored.
   */
  async createChallenge(kioskDeviceKey: string) {
    const kiosk = await this.getActiveKiosk(kioskDeviceKey);

    // One active challenge per kiosk: drop unused ones.
    await this.prisma.kioskQrChallenge.deleteMany({
      where: { kioskId: kiosk.id, usedAt: null },
    });

    const token = randomBytes(16).toString('hex'); // 32 hex chars
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);

    const challenge = await this.prisma.kioskQrChallenge.create({
      data: {
        kioskId: kiosk.id,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    return {
      challengeId: challenge.id,
      token,
      expiresAt,
      refreshInSeconds: CHALLENGE_TTL_SECONDS,
    };
  }

  /** Kiosk polling endpoint: pending | consumed | expired. */
  async getChallengeStatus(challengeId: string, kioskDeviceKey: string) {
    const kiosk = await this.getActiveKiosk(kioskDeviceKey);

    const challenge = await this.prisma.kioskQrChallenge.findUnique({
      where: { id: challengeId },
      include: {
        usedByUser: { select: { fullName: true } },
      },
    });

    if (!challenge || challenge.kioskId !== kiosk.id) {
      throw new NotFoundException('Challenge not found for this kiosk');
    }

    if (challenge.usedAt) {
      return {
        status: 'consumed' as const,
        employeeName: challenge.usedByUser?.fullName ?? null,
        action: challenge.action,
        time: challenge.usedAt,
      };
    }

    if (challenge.expiresAt <= new Date()) {
      return { status: 'expired' as const };
    }

    return { status: 'pending' as const };
  }

  /**
   * Employee phone consumes a scanned kiosk QR token (JWT authenticated).
   * Consumption and the attendance write happen in one transaction; the
   * conditional updateMany guarantees only one caller wins a given token.
   */
  async scan(userId: string, rawToken: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new BadRequestException('Your account is inactive. Contact admin.');
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const challenge = await this.prisma.kioskQrChallenge.findUnique({
      where: { tokenHash },
      include: { kiosk: true },
    });

    if (!challenge) {
      await this.audit(null, 'KIOSK_QR_SCAN_INVALID', {
        reason: 'unknown_token',
        userId,
      });
      throw new BadRequestException(
        'This is not a valid attendance QR code. Scan the code on the kiosk screen.',
      );
    }

    if (!challenge.kiosk.isActive) {
      throw new BadRequestException('This kiosk is inactive. Contact admin.');
    }

    if (challenge.usedAt) {
      throw new BadRequestException(
        'This QR code was already used. Wait for the kiosk to show a fresh one.',
      );
    }

    if (challenge.expiresAt <= new Date()) {
      await this.audit(userId, 'KIOSK_QR_SCAN_EXPIRED', {
        challengeId: challenge.id,
        kioskId: challenge.kioskId,
      });
      throw new BadRequestException(
        'This QR code has expired. Scan the new code on the kiosk.',
      );
    }

    const now = new Date();

    let result: {
      action: AttendanceOtpAction;
      attendance: { id: string; clockIn: Date; clockOut: Date | null };
    };

    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Atomic single-use consumption: only one request can flip usedAt.
        const consumed = await tx.kioskQrChallenge.updateMany({
          where: {
            id: challenge.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            usedAt: now,
            usedByUserId: userId,
          },
        });

        if (consumed.count === 0) {
          throw new ConflictException(
            'This QR code was just used by someone else. Wait for the kiosk to show a fresh one.',
          );
        }

        const openAttendance = await tx.attendance.findFirst({
          where: { userId, clockOut: null },
          orderBy: { clockIn: 'desc' },
        });

        const action = openAttendance
          ? AttendanceOtpAction.CLOCK_OUT
          : AttendanceOtpAction.CLOCK_IN;

        const attendance = openAttendance
          ? await tx.attendance.update({
              where: { id: openAttendance.id },
              data: {
                clockOut: now,
                methodOut: AttendanceMethod.MOBILE_QR,
                kioskOutId: challenge.kioskId,
              },
            })
          : await tx.attendance.create({
              data: {
                userId,
                clockIn: now,
                methodIn: AttendanceMethod.MOBILE_QR,
                kioskInId: challenge.kioskId,
              },
            });

        await tx.kioskQrChallenge.update({
          where: { id: challenge.id },
          data: { action },
        });

        return { action, attendance };
      });
    } catch (error) {
      // Partial unique index "Attendance_one_open_per_user": another
      // concurrent flow opened a record first. Deterministic conflict.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You were clocked in by another action at the same time. Check your status.',
        );
      }
      throw error;
    }

    await this.audit(
      userId,
      result.action === AttendanceOtpAction.CLOCK_IN
        ? 'CLOCK_IN_KIOSK_QR'
        : 'CLOCK_OUT_KIOSK_QR',
      {
        challengeId: challenge.id,
        kioskId: challenge.kioskId,
        attendanceId: result.attendance.id,
      },
      'Attendance',
      result.attendance.id,
    );

    return {
      success: true,
      action: result.action,
      attendance: result.attendance,
      user: { fullName: user.fullName },
      kiosk: {
        id: challenge.kiosk.id,
        name: challenge.kiosk.name,
        location: challenge.kiosk.location,
      },
    };
  }

  private async audit(
    actorUserId: string | null,
    action: string,
    metadata: Record<string, any>,
    entityType: string | null = 'KioskQrChallenge',
    entityId: string | null = null,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType,
        entityId,
        metadata,
      },
    });
  }
}
