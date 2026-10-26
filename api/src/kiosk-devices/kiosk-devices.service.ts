import { Injectable, NotFoundException } from '@nestjs/common';
import { Kiosk, Location, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateKioskDeviceDto } from './dto/update-kiosk-device.dto';

type KioskWithLocation = Kiosk & { locationRef?: Location | null };

/**
 * ADMIN-only management of EXISTING kiosk devices (tablets). Every response
 * exposes only the LAST 4 characters of the device key — the full secret is
 * never returned to an admin from any endpoint. New kiosks are created solely
 * by the universal-APK enrollment flow (KioskEnrollmentService.approve), which
 * mints the secret and delivers it only to the enrolling tablet.
 */
@Injectable()
export class KioskDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(kiosk: KioskWithLocation) {
    return {
      id: kiosk.id,
      name: kiosk.name,
      locationId: kiosk.locationId,
      locationName: kiosk.locationRef?.name ?? null,
      legacyLocationLabel: kiosk.location ?? null,
      isActive: kiosk.isActive,
      lastSeenAt: kiosk.lastSeenAt,
      // Never expose the full device key.
      deviceKeyLast4: kiosk.deviceKey.slice(-4),
      createdAt: kiosk.createdAt,
      updatedAt: kiosk.updatedAt,
    };
  }

  private async requireLocation(locationId: string): Promise<Location> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    return location;
  }

  private async audit(
    actorUserId: string | null,
    action: string,
    kioskId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'Kiosk',
        entityId: kioskId,
        // Never log the full device key.
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  async list() {
    const kiosks = await this.prisma.kiosk.findMany({
      orderBy: [{ name: 'asc' }],
      include: { locationRef: true },
    });
    return kiosks.map((k) => this.toResponse(k));
  }

  async update(
    actorUserId: string | null,
    id: string,
    dto: UpdateKioskDeviceDto,
  ) {
    const existing = await this.prisma.kiosk.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Kiosk device not found');
    }
    if (dto.locationId) {
      await this.requireLocation(dto.locationId);
    }

    const updated = await this.prisma.kiosk.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { locationRef: true },
    });

    await this.audit(actorUserId, 'KIOSK_DEVICE_UPDATED', id, {
      changed: Object.keys(dto),
    });

    return this.toResponse(updated);
  }

  async setActive(actorUserId: string | null, id: string, isActive: boolean) {
    const existing = await this.prisma.kiosk.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Kiosk device not found');
    }
    const updated = await this.prisma.kiosk.update({
      where: { id },
      data: { isActive },
      include: { locationRef: true },
    });
    await this.audit(
      actorUserId,
      isActive ? 'KIOSK_DEVICE_ACTIVATED' : 'KIOSK_DEVICE_DEACTIVATED',
      id,
    );
    return this.toResponse(updated);
  }

  async assignLocation(
    actorUserId: string | null,
    id: string,
    locationId: string,
  ) {
    const existing = await this.prisma.kiosk.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Kiosk device not found');
    }
    const location = await this.requireLocation(locationId);
    const updated = await this.prisma.kiosk.update({
      where: { id },
      data: { locationId: location.id },
      include: { locationRef: true },
    });
    await this.audit(actorUserId, 'KIOSK_DEVICE_LOCATION_ASSIGNED', id, {
      locationId: location.id,
      locationName: location.name,
    });
    return this.toResponse(updated);
  }
}
