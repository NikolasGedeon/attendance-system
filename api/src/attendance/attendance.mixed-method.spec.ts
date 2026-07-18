import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttendanceMethod, AttendanceOtpAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KioskService } from '../kiosk/kiosk.service';
import { AttendanceService } from './attendance.service';

/**
 * Mixed-method clocking: every method (employee app GPS, kiosk card, OTP,
 * kiosk-displayed QR, admin manual) must share ONE open-attendance state:
 * lookup by { userId, clockOut: null } with no filtering by method, kiosk
 * or location.
 */
describe('Mixed-method attendance consistency', () => {
  let prisma: any;

  const openCardRecord = {
    id: 'a1',
    userId: 'u1',
    clockIn: new Date(Date.now() - 60 * 60 * 1000),
    clockOut: null,
    methodIn: AttendanceMethod.CARD, // opened at the kiosk with a card
    kioskInId: 'k1',
    isEdited: false,
  };

  beforeEach(() => {
    prisma = {
      attendance: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(), update: jest.fn() },
      kiosk: { findUnique: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };
  });

  describe('AttendanceService (employee app)', () => {
    let service: AttendanceService;

    beforeEach(() => {
      service = new AttendanceService(prisma as unknown as PrismaService);
    });

    it('clock-out closes a CARD-opened record (no method filtering)', async () => {
      prisma.attendance.findFirst.mockResolvedValue(openCardRecord);
      prisma.attendance.update.mockResolvedValue({
        ...openCardRecord,
        clockOut: new Date(),
      });

      const result = await service.clockOut('u1');

      // The lookup must be strictly userId + open, nothing else.
      expect(prisma.attendance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', clockOut: null },
        }),
      );
      expect(prisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a1' } }),
      );
      expect(result.clockOut).not.toBeNull();
    });

    it('clock-out with no open record fails cleanly', async () => {
      prisma.attendance.findFirst.mockResolvedValue(null);
      await expect(service.clockOut('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.attendance.update).not.toHaveBeenCalled();
    });

    it('concurrent clock-in loses deterministically (P2002 -> conflict)', async () => {
      prisma.attendance.findFirst.mockResolvedValue(null); // check passed
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        location: {
          id: 'l1',
          name: 'Office',
          latitude: 35.0,
          longitude: 33.0,
          radiusMeters: 150,
          isActive: true,
        },
      });
      // ...but another request wins the create.
      prisma.attendance.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.clockIn('u1', 35.0, 33.0)).rejects.toMatchObject({
        status: 409,
      });
    });
  });

  describe('KioskService (card / OTP / manual)', () => {
    let service: KioskService;

    beforeEach(() => {
      const smsStub = { smsEnabled: false, devShowCode: false } as any;
      service = new KioskService(
        prisma as unknown as PrismaService,
        smsStub,
      );
    });

    it('card scan clocks OUT a record opened by the phone QR flow', async () => {
      // Open record created by MOBILE_QR — the card must close it anyway.
      const qrOpened = { ...openCardRecord, methodIn: AttendanceMethod.MOBILE_QR };
      prisma.attendance.findFirst.mockResolvedValue(qrOpened);
      prisma.attendance.update.mockResolvedValue({
        ...qrOpened,
        clockOut: new Date(),
        methodOut: AttendanceMethod.CARD,
      });

      const result = await (service as any).performAttendanceAction({
        userId: 'u1',
        kioskId: 'k1',
        action: AttendanceOtpAction.CLOCK_OUT,
        method: AttendanceMethod.CARD,
      });

      expect(prisma.attendance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', clockOut: null },
        }),
      );
      expect(result.methodOut).toBe(AttendanceMethod.CARD);
    });

    it('getNextAction depends only on the open state, not the method', async () => {
      prisma.attendance.findFirst.mockResolvedValue({
        ...openCardRecord,
        methodIn: AttendanceMethod.MANUAL,
      });
      const action = await (service as any).getNextAction('u1');
      expect(action).toBe(AttendanceOtpAction.CLOCK_OUT);

      prisma.attendance.findFirst.mockResolvedValue(null);
      const action2 = await (service as any).getNextAction('u1');
      expect(action2).toBe(AttendanceOtpAction.CLOCK_IN);
    });

    it('concurrent kiosk clock-in loses deterministically (P2002)', async () => {
      prisma.attendance.findFirst.mockResolvedValue(null);
      prisma.attendance.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('conflict', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        (service as any).performAttendanceAction({
          userId: 'u1',
          kioskId: 'k1',
          action: AttendanceOtpAction.CLOCK_IN,
          method: AttendanceMethod.CARD,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completed records are never selected for clock-out', async () => {
      // findFirst filters clockOut: null, so a completed record is invisible.
      prisma.attendance.findFirst.mockResolvedValue(null);
      await expect(
        (service as any).performAttendanceAction({
          userId: 'u1',
          kioskId: 'k1',
          action: AttendanceOtpAction.CLOCK_OUT,
          method: AttendanceMethod.CARD,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.attendance.update).not.toHaveBeenCalled();
    });
  });
});
