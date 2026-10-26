import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { KioskQrService } from './kiosk-qr.service';

/**
 * Stage 8 regression: a kiosk with no assigned location must be rejected
 * BEFORE a QR challenge is created/displayed.
 */
describe('KioskQrService.createChallenge — early location validation', () => {
  let prisma: any;
  let service: KioskQrService;

  const orphanKiosk = { id: 'k1', isActive: true, locationId: null };

  beforeEach(() => {
    prisma = {
      kiosk: {
        findUnique: jest.fn().mockResolvedValue(orphanKiosk),
        update: jest.fn().mockResolvedValue(orphanKiosk),
      },
      kioskQrChallenge: { deleteMany: jest.fn(), create: jest.fn() },
    };
    service = new KioskQrService(
      prisma as unknown as PrismaService,
      {} as unknown as ClockAttemptService,
    );
  });

  it('rejects a location-less kiosk and never creates a challenge', async () => {
    await expect(service.createChallenge('key')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.kioskQrChallenge.deleteMany).not.toHaveBeenCalled();
    expect(prisma.kioskQrChallenge.create).not.toHaveBeenCalled();
  });
});
