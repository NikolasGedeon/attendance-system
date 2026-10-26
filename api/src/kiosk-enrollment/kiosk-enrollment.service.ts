import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KioskEnrollmentStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveEnrollmentDto } from './dto/approve-enrollment.dto';
import { RegisterStartDto } from './dto/register-start.dto';

/**
 * Self-service kiosk enrollment for the UNIVERSAL kiosk APK.
 *
 * Security model:
 *  - The APK ships with NO device key. A fresh install requests a one-time
 *    registration code (PENDING). The code is short-lived and single-use.
 *  - Only the SHA-256 hash of the code is stored; the plaintext code lives only
 *    on the tablet. Admin displays use the last 4 characters (non-secret).
 *  - An ADMIN assigns a name + Location and APPROVES. Approval generates the
 *    real device secret (Kiosk.deviceKey). The secret is delivered to the
 *    tablet exactly once (while APPROVED, before CONSUMED) and never shown to
 *    the admin (they only ever see the last 4).
 *  - The tablet CONSUMES the enrollment after storing the secret, so the code
 *    can never be replayed to fetch the secret again.
 *  - Revocation of a lost/stolen tablet is done by deactivating its Kiosk
 *    (ADMIN /admin/kiosk-devices/:id/deactivate), which the /kiosk/config gate
 *    rejects immediately.
 */
const CODE_TTL_MS = 15 * 60 * 1000; // PENDING code lifetime
const APPROVED_TTL_MS = 30 * 60 * 1000; // window to fetch the secret after approval
const POLL_INTERVAL_SECONDS = 5;
// Unambiguous alphabet (no 0/O/1/I/L) so a person can read the code aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

@Injectable()
export class KioskEnrollmentService {
  constructor(private readonly prisma: PrismaService) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private generateCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return out;
  }

  private async audit(
    actorUserId: string | null,
    action: string,
    enrollmentId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'KioskEnrollment',
        entityId: enrollmentId,
        // Never log the registration code or the device key.
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  // ---- Tablet (public, no JWT) --------------------------------------------

  /** POST /kiosk/register/start — a fresh tablet requests a registration code. */
  async start(dto: RegisterStartDto) {
    // Generate a unique code (retry on the astronomically-unlikely hash clash).
    let code = this.generateCode();
    let codeHash = this.hashCode(code);
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await this.prisma.kioskEnrollment.findUnique({
        where: { codeHash },
      });
      if (!clash) break;
      code = this.generateCode();
      codeHash = this.hashCode(code);
    }

    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.prisma.kioskEnrollment.create({
      data: {
        codeHash,
        codeLast4: code.slice(-4),
        status: KioskEnrollmentStatus.PENDING,
        deviceModel: dto.deviceModel?.trim() || null,
        deviceSerial: dto.deviceSerial?.trim() || null,
        appVersion: dto.appVersion?.trim() || null,
        expiresAt,
      },
    });

    return {
      code,
      status: KioskEnrollmentStatus.PENDING,
      expiresAt,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    };
  }

  /**
   * POST /kiosk/register/poll — the tablet polls with its code. Returns the
   * device secret exactly once, while APPROVED and not yet CONSUMED.
   */
  async poll(code: string) {
    const trimmed = (code ?? '').trim();
    if (!trimmed) {
      return { status: 'NOT_FOUND' as const };
    }
    const enrollment = await this.prisma.kioskEnrollment.findUnique({
      where: { codeHash: this.hashCode(trimmed) },
      include: { kiosk: { include: { locationRef: true } } },
    });
    if (!enrollment) {
      return { status: 'NOT_FOUND' as const };
    }

    const now = Date.now();
    const expired = enrollment.expiresAt.getTime() < now;

    if (
      (enrollment.status === KioskEnrollmentStatus.PENDING ||
        enrollment.status === KioskEnrollmentStatus.APPROVED) &&
      expired
    ) {
      await this.prisma.kioskEnrollment.update({
        where: { id: enrollment.id },
        data: { status: KioskEnrollmentStatus.EXPIRED },
      });
      return { status: KioskEnrollmentStatus.EXPIRED };
    }

    if (enrollment.status === KioskEnrollmentStatus.PENDING) {
      return {
        status: KioskEnrollmentStatus.PENDING,
        pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      };
    }

    if (enrollment.status === KioskEnrollmentStatus.APPROVED) {
      const kiosk = enrollment.kiosk;
      if (!kiosk) {
        // Should never happen; approval always links a kiosk.
        return { status: KioskEnrollmentStatus.EXPIRED };
      }
      return {
        status: KioskEnrollmentStatus.APPROVED,
        // Delivered exactly once — the tablet stores it, then confirms.
        deviceKey: kiosk.deviceKey,
        kiosk: {
          id: kiosk.id,
          name: kiosk.name,
          locationId: kiosk.locationId,
          locationName: kiosk.locationRef?.name ?? null,
          locationAssigned: !!kiosk.locationId,
        },
      };
    }

    // CONSUMED / REJECTED / EXPIRED — never returns a secret.
    return { status: enrollment.status };
  }

  /** POST /kiosk/register/confirm — the tablet acknowledges it stored the key. */
  async confirm(code: string) {
    const trimmed = (code ?? '').trim();
    const enrollment = trimmed
      ? await this.prisma.kioskEnrollment.findUnique({
          where: { codeHash: this.hashCode(trimmed) },
        })
      : null;
    if (!enrollment) {
      throw new NotFoundException('Registration code not found');
    }
    if (enrollment.status === KioskEnrollmentStatus.CONSUMED) {
      return { status: KioskEnrollmentStatus.CONSUMED }; // idempotent
    }
    if (enrollment.status !== KioskEnrollmentStatus.APPROVED) {
      throw new BadRequestException('Enrollment is not ready to be confirmed');
    }
    await this.prisma.kioskEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: KioskEnrollmentStatus.CONSUMED,
        consumedAt: new Date(),
      },
    });
    return { status: KioskEnrollmentStatus.CONSUMED };
  }

  // ---- Admin (JWT + ADMIN) ------------------------------------------------

  /** GET /admin/kiosk-enrollments — pending + recently-handled requests. */
  async listForAdmin(statusFilter?: string) {
    const where: Prisma.KioskEnrollmentWhereInput = {};
    if (statusFilter && statusFilter !== 'all') {
      const normalized = statusFilter.toUpperCase();
      if (
        (Object.values(KioskEnrollmentStatus) as string[]).includes(normalized)
      ) {
        where.status = normalized as KioskEnrollmentStatus;
      }
    } else if (!statusFilter) {
      // Default view: things that still need attention or were just handled.
      where.status = {
        in: [
          KioskEnrollmentStatus.PENDING,
          KioskEnrollmentStatus.APPROVED,
        ],
      };
    }

    const rows = await this.prisma.kioskEnrollment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      include: { kiosk: { include: { locationRef: true } } },
    });

    // A device serial seen on an earlier (non-pending) enrollment means this is
    // a re-enrollment that an admin should scrutinise before approving.
    const serials = rows
      .map((r) => r.deviceSerial)
      .filter((s): s is string => !!s);
    const priorSerials = new Set<string>();
    if (serials.length) {
      const priors = await this.prisma.kioskEnrollment.findMany({
        where: {
          deviceSerial: { in: serials },
          status: {
            in: [
              KioskEnrollmentStatus.APPROVED,
              KioskEnrollmentStatus.CONSUMED,
            ],
          },
        },
        select: { deviceSerial: true },
      });
      priors.forEach((p) => p.deviceSerial && priorSerials.add(p.deviceSerial));
    }

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      codeLast4: r.codeLast4,
      deviceModel: r.deviceModel,
      deviceSerial: r.deviceSerial,
      appVersion: r.appVersion,
      kioskId: r.kioskId,
      kioskName: r.kiosk?.name ?? null,
      locationId: r.kiosk?.locationId ?? null,
      locationName: r.kiosk?.locationRef?.name ?? null,
      isExpired: r.expiresAt.getTime() < now,
      isReenrollment: !!r.deviceSerial && priorSerials.has(r.deviceSerial),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      approvedAt: r.approvedAt,
    }));
  }

  /**
   * POST /admin/kiosk-enrollments/:id/approve — assign name + Location and mint
   * the device secret. The full secret is NEVER returned here; it is delivered
   * only to the tablet via poll.
   */
  async approve(
    actorUserId: string | null,
    id: string,
    dto: ApproveEnrollmentDto,
  ) {
    const enrollment = await this.prisma.kioskEnrollment.findUnique({
      where: { id },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    if (enrollment.status !== KioskEnrollmentStatus.PENDING) {
      throw new BadRequestException(
        `Enrollment cannot be approved from status ${enrollment.status}`,
      );
    }
    if (enrollment.expiresAt.getTime() < Date.now()) {
      await this.prisma.kioskEnrollment.update({
        where: { id },
        data: { status: KioskEnrollmentStatus.EXPIRED },
      });
      throw new BadRequestException(
        'This registration code has expired. Ask the tablet to request a new code.',
      );
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
      });
      if (!location) {
        throw new NotFoundException('Location not found');
      }
    }

    const deviceKey = randomBytes(24).toString('hex');

    const result = await this.prisma.$transaction(async (tx) => {
      const kiosk = await tx.kiosk.create({
        data: {
          name: dto.name.trim(),
          deviceKey,
          locationId: dto.locationId ?? null,
          deviceInfo: enrollment.deviceModel ?? null,
        },
        include: { locationRef: true },
      });
      const updated = await tx.kioskEnrollment.update({
        where: { id },
        data: {
          status: KioskEnrollmentStatus.APPROVED,
          kioskId: kiosk.id,
          approvedById: actorUserId,
          approvedAt: new Date(),
          // Give the tablet a window to fetch the secret.
          expiresAt: new Date(Date.now() + APPROVED_TTL_MS),
        },
      });
      return { kiosk, updated };
    });

    await this.audit(actorUserId, 'KIOSK_ENROLLMENT_APPROVED', id, {
      kioskId: result.kiosk.id,
      name: result.kiosk.name,
      locationId: result.kiosk.locationId,
      codeLast4: enrollment.codeLast4,
      deviceModel: enrollment.deviceModel,
    });

    return {
      enrollmentId: id,
      status: KioskEnrollmentStatus.APPROVED,
      kiosk: {
        id: result.kiosk.id,
        name: result.kiosk.name,
        locationId: result.kiosk.locationId,
        locationName: result.kiosk.locationRef?.name ?? null,
        // Only the last 4 — the full secret goes to the tablet, never here.
        deviceKeyLast4: deviceKey.slice(-4),
      },
    };
  }

  /** POST /admin/kiosk-enrollments/:id/reject */
  async reject(actorUserId: string | null, id: string) {
    const enrollment = await this.prisma.kioskEnrollment.findUnique({
      where: { id },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    if (enrollment.status !== KioskEnrollmentStatus.PENDING) {
      throw new BadRequestException(
        `Enrollment cannot be rejected from status ${enrollment.status}`,
      );
    }
    await this.prisma.kioskEnrollment.update({
      where: { id },
      data: { status: KioskEnrollmentStatus.REJECTED },
    });
    await this.audit(actorUserId, 'KIOSK_ENROLLMENT_REJECTED', id, {
      codeLast4: enrollment.codeLast4,
    });
    return { enrollmentId: id, status: KioskEnrollmentStatus.REJECTED };
  }
}
