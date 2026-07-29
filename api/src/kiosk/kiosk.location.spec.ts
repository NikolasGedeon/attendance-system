import { AttendanceMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { KioskService } from './kiosk.service';

/**
 * Task 1: kiosk clock events must record the ACTUAL location, resolved
 * server-side from the kiosk device — never the employee's assigned location,
 * never a client-supplied value. The assigned User.locationId is untouched.
 */
describe('KioskService — actual location resolution', () => {
  let prisma: any;
  let sms: any;
  let clockAttempts: any;
  let service: KioskService;

  const GAIA = 'loc-gaia';
  const STREGIS = 'loc-stregis';

  // Employee ASSIGNED to GAIA.
  const employee = {
    id: 'emp1',
    fullName: 'Ana Employee',
    isActive: true,
    cardDisabledAt: null,
    cardOtpLocked: false,
    requireOtpForCard: false,
    locationId: GAIA,
    employeeCode: 'E1',
    department: 'Ops',
  };

  const kioskAt = (id: string, locationId: string | null) => ({
    id,
    name: id,
    isActive: true,
    locationId,
  });

  beforeEach(() => {
    sms = { smsEnabled: false, devShowCode: false, sendOtp: jest.fn() };
    clockAttempts = {
      resolveFailedClockIns: jest.fn().mockResolvedValue({ count: 0 }),
      recordFailedClockIn: jest.fn().mockResolvedValue({}),
    };
    prisma = {
      kiosk: { findUnique: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new KioskService(
      prisma as unknown as PrismaService,
      sms as unknown as SmsService,
      clockAttempts as unknown as ClockAttemptService,
    );
  });

  function mockKiosk(kiosk: any) {
    prisma.kiosk.findUnique.mockResolvedValue(kiosk);
    prisma.kiosk.update.mockResolvedValue(kiosk); // getActiveKiosk returns update()
  }

  it('GAIA employee clocks in at GAIA-KIOSK-01 → actual location = GAIA', async () => {
    mockKiosk(kioskAt('GAIA-KIOSK-01', GAIA));
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.attendance.create.mockResolvedValue({ id: 'att1', clockIn: new Date() });

    await service.cardScan({
      cardUid: 'CARD-1',
      kioskDeviceKey: 'key-gaia-01',
    } as any);

    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'emp1',
        methodIn: AttendanceMethod.CARD,
        kioskInId: 'GAIA-KIOSK-01',
        clockInLocationId: GAIA,
      }),
    });
    // Assigned workplace must NOT be mutated.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('GAIA employee clocks in at STREGIS-KIOSK-02 → actual location = St Regis, assigned still GAIA', async () => {
    mockKiosk(kioskAt('STREGIS-KIOSK-02', STREGIS));
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.attendance.create.mockResolvedValue({ id: 'att2', clockIn: new Date() });

    await service.cardScan({
      cardUid: 'CARD-1',
      kioskDeviceKey: 'key-stregis-02',
    } as any);

    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clockInLocationId: STREGIS,
        kioskInId: 'STREGIS-KIOSK-02',
      }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    // A successful clock-in resolves any failed-attempt sequence.
    expect(clockAttempts.resolveFailedClockIns).toHaveBeenCalledWith(
      'emp1',
      'att2',
    );
  });

  it('rejects an unknown kiosk key', async () => {
    prisma.kiosk.findUnique.mockResolvedValue(null);
    await expect(
      service.cardScan({ cardUid: 'CARD-1', kioskDeviceKey: 'nope' } as any),
    ).rejects.toThrow(/invalid or inactive kiosk/i);
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive kiosk', async () => {
    prisma.kiosk.findUnique.mockResolvedValue({
      ...kioskAt('GAIA-KIOSK-01', GAIA),
      isActive: false,
    });
    await expect(
      service.cardScan({ cardUid: 'CARD-1', kioskDeviceKey: 'key' } as any),
    ).rejects.toThrow(/invalid or inactive kiosk/i);
  });

  it('rejects a kiosk that has no assigned location', async () => {
    mockKiosk(kioskAt('ORPHAN-KIOSK', null));
    prisma.user.findUnique.mockResolvedValue(employee);
    await expect(
      service.cardScan({ cardUid: 'CARD-1', kioskDeviceKey: 'key' } as any),
    ).rejects.toThrow(/not assigned to a work location/i);
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('clock-out can happen at a different kiosk/location than clock-in', async () => {
    // Employee already has an OPEN record (opened at GAIA earlier).
    const open = { id: 'att-open', userId: 'emp1', clockIn: new Date(), clockOut: null };
    prisma.attendance.findFirst.mockResolvedValue(open);
    mockKiosk(kioskAt('STREGIS-KIOSK-02', STREGIS));
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.attendance.update.mockResolvedValue({
      ...open,
      clockOut: new Date(),
    });

    await service.cardScan({
      cardUid: 'CARD-1',
      kioskDeviceKey: 'key-stregis-02',
    } as any);

    expect(prisma.attendance.update).toHaveBeenCalledWith({
      where: { id: 'att-open' },
      data: expect.objectContaining({
        methodOut: AttendanceMethod.CARD,
        kioskOutId: 'STREGIS-KIOSK-02',
        clockOutLocationId: STREGIS,
      }),
    });
  });
});
