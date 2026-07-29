import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KioskDevicesService } from './kiosk-devices.service';

describe('KioskDevicesService', () => {
  let prisma: any;
  let service: KioskDevicesService;

  const gaia = { id: 'loc-gaia', name: 'GAIA' };

  beforeEach(() => {
    prisma = {
      location: { findUnique: jest.fn().mockResolvedValue(gaia) },
      kiosk: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new KioskDevicesService(prisma as unknown as PrismaService);
  });

  it('allows multiple kiosks to reference the SAME location', async () => {
    prisma.kiosk.create
      .mockResolvedValueOnce({
        id: 'k1',
        name: 'GAIA-KIOSK-01',
        deviceKey: 'aaaabbbbcccc1111',
        locationId: gaia.id,
        location: null,
        isActive: true,
        lastSeenAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        locationRef: gaia,
      })
      .mockResolvedValueOnce({
        id: 'k2',
        name: 'GAIA-KIOSK-02',
        deviceKey: 'ddddeeeeffff2222',
        locationId: gaia.id,
        location: null,
        isActive: true,
        lastSeenAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        locationRef: gaia,
      });

    const one = await service.create('admin1', {
      name: 'GAIA-KIOSK-01',
      locationId: gaia.id,
    });
    const two = await service.create('admin1', {
      name: 'GAIA-KIOSK-02',
      locationId: gaia.id,
    });

    expect(one.locationId).toBe(gaia.id);
    expect(two.locationId).toBe(gaia.id);
    // Full key returned exactly once, and only the last 4 are otherwise exposed.
    expect(one.deviceKey).toBeDefined();
    expect(one.deviceKeyLast4).toBe('1111');
  });

  it('rejects a duplicate device key', async () => {
    prisma.kiosk.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.create('admin1', {
        name: 'DUP',
        locationId: gaia.id,
        deviceKey: 'already-exists-key',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never exposes the full device key in list responses', async () => {
    // (list uses toResponse, which only emits deviceKeyLast4)
    prisma.kiosk.findMany = jest.fn().mockResolvedValue([
      {
        id: 'k1',
        name: 'GAIA-KIOSK-01',
        deviceKey: 'superSecretKey9999',
        locationId: gaia.id,
        location: null,
        isActive: true,
        lastSeenAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        locationRef: gaia,
      },
    ]);
    const rows = await service.list();
    expect(rows[0]).not.toHaveProperty('deviceKey');
    expect(rows[0].deviceKeyLast4).toBe('9999');
  });
});
