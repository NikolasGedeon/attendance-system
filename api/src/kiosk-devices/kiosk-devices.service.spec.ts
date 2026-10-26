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

  it('has no create method — new kiosks come only from enrollment', () => {
    // The legacy manual-create path (which returned a full device key to the
    // admin) has been removed. Kiosks are minted by KioskEnrollmentService only.
    expect((service as any).create).toBeUndefined();
  });

  it('never exposes the full device key in list responses', async () => {
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

  it('never exposes the full device key when assigning a location', async () => {
    prisma.kiosk.findUnique.mockResolvedValue({ id: 'k1', deviceKey: 'x' });
    prisma.kiosk.update.mockResolvedValue({
      id: 'k1',
      name: 'GAIA-KIOSK-01',
      deviceKey: 'superSecretKey4242',
      locationId: gaia.id,
      location: null,
      isActive: true,
      lastSeenAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      locationRef: gaia,
    });
    const res = await service.assignLocation('admin1', 'k1', gaia.id);
    expect(res).not.toHaveProperty('deviceKey');
    expect(res.deviceKeyLast4).toBe('4242');
  });
});
