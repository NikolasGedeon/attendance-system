import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { KioskService } from './kiosk.service';

/**
 * Stage 8 regression: a kiosk with no assigned location must be rejected
 * BEFORE any SMS OTP is created/sent.
 */
describe('KioskService.cardScan — early location validation', () => {
  let prisma: any;
  let sms: any;
  let service: KioskService;

  const orphanKiosk = { id: 'k1', isActive: true, locationId: null };

  beforeEach(() => {
    sms = { smsEnabled: true, devShowCode: false, sendOtp: jest.fn() };
    prisma = {
      kiosk: {
        findUnique: jest.fn().mockResolvedValue(orphanKiosk),
        update: jest.fn().mockResolvedValue(orphanKiosk),
      },
      user: { findUnique: jest.fn() },
      attendanceOtp: { create: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new KioskService(
      prisma as unknown as PrismaService,
      sms as unknown as SmsService,
      {} as unknown as ClockAttemptService,
    );
  });

  it('rejects a location-less kiosk and never creates/sends an OTP', async () => {
    await expect(
      service.cardScan({ cardUid: 'CARD-1', kioskDeviceKey: 'key' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No card lookup, no OTP row, no SMS.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.attendanceOtp.create).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });
});
