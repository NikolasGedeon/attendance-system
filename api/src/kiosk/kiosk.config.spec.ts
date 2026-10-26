import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { KioskService } from './kiosk.service';

describe('KioskService.getKioskConfig', () => {
  let prisma: any;
  let service: KioskService;

  beforeEach(() => {
    prisma = { kiosk: { findUnique: jest.fn(), update: jest.fn() } };
    service = new KioskService(
      prisma as unknown as PrismaService,
      { smsEnabled: false, devShowCode: false } as unknown as SmsService,
      {} as unknown as ClockAttemptService,
    );
  });

  it('rejects an unknown kiosk key', async () => {
    prisma.kiosk.findUnique.mockResolvedValue(null);
    await expect(
      service.getKioskConfig({ kioskDeviceKey: 'nope' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.kiosk.update).not.toHaveBeenCalled();
  });

  it('rejects an inactive kiosk', async () => {
    prisma.kiosk.findUnique.mockResolvedValue({
      id: 'k1',
      isActive: false,
      locationId: 'gaia',
    });
    await expect(
      service.getKioskConfig({ kioskDeviceKey: 'key' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.kiosk.update).not.toHaveBeenCalled();
  });

  it('returns identity + location and updates lastSeenAt for a valid kiosk', async () => {
    prisma.kiosk.findUnique.mockResolvedValue({
      id: 'k1',
      isActive: true,
      locationId: 'gaia',
      deviceKey: 'super-secret-key',
    });
    prisma.kiosk.update.mockResolvedValue({
      id: 'k1',
      name: 'GAIA-KIOSK-01',
      isActive: true,
      locationId: 'gaia',
      lastSeenAt: new Date(),
      locationRef: { id: 'gaia', name: 'GAIA' },
    });

    const res = await service.getKioskConfig({
      kioskDeviceKey: 'key',
      appVersion: '1.2.3',
      deviceInfo: 'Pixel Tablet / Android 14',
    });

    expect(res.name).toBe('GAIA-KIOSK-01');
    expect(res.locationName).toBe('GAIA');
    expect(res.locationAssigned).toBe(true);
    expect(res.isActive).toBe(true);
    expect((res as any).deviceKey).toBeUndefined(); // full key never returned
    const data = prisma.kiosk.update.mock.calls[0][0].data;
    expect(data.lastSeenAt).toBeInstanceOf(Date);
    expect(data.appVersion).toBe('1.2.3');
    expect(data.deviceInfo).toBe('Pixel Tablet / Android 14');
  });

  it('reports an explicit location-not-assigned state (not a rejection)', async () => {
    prisma.kiosk.findUnique.mockResolvedValue({
      id: 'k2',
      isActive: true,
      locationId: null,
    });
    prisma.kiosk.update.mockResolvedValue({
      id: 'k2',
      name: 'ORPHAN',
      isActive: true,
      locationId: null,
      lastSeenAt: new Date(),
      locationRef: null,
    });
    const res = await service.getKioskConfig({ kioskDeviceKey: 'key' });
    expect(res.locationAssigned).toBe(false);
    expect(res.locationId).toBeNull();
    expect(res.locationName).toBeNull();
  });
});
