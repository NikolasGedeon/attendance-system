import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kiosk, Location, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKioskDeviceDto } from './dto/create-kiosk-device.dto';
import { UpdateKioskDeviceDto } from './dto/update-kiosk-device.dto';

type KioskWithLocation = Kiosk & { locationRef?: Location | null };

/**
 * ADMIN-only management of kiosk devices (tablets). Each device has a unique
 * deviceKey and belongs to a physical Location. The full deviceKey is returned
 * ONCE on creation (so the tablet can be provisioned) and never again — every
 * other response exposes only the last 4 characters.
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

  async create(actorUserId: string | null, dto: CreateKioskDeviceDto) {
    if (dto.locationId) {
      await this.requireLocation(dto.locationId);
    }

    const deviceKey = (dto.deviceKey ?? randomBytes(24).toString('hex')).trim();

    let created: KioskWithLocation;
    try {
      created = await this.prisma.kiosk.create({
        data: {
          name: dto.name.trim(),
          deviceKey,
          locationId: dto.locationId ?? null,
          location: dto.location?.trim() ?? null,
        },
        include: { locationRef: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('A kiosk with this device key already exists');
      }
      throw error;
    }

    await this.audit(actorUserId, 'KIOSK_DEVICE_CREATED', created.id, {
      name: created.name,
      locationId: created.locationId,
    });

    // Full deviceKey returned exactly once, so the tablet can be provisioned.
    return {
      ...this.toResponse(created),
      deviceKey,
      warning:
        'Store this device key now. It is shown only once and cannot be retrieved later.',
    };
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
