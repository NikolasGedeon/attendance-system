import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AttendanceMethod, Role } from '@prisma/client';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerService } from './manager.service';

describe('ManagerService — clock-in override eligibility & audit', () => {
  let prisma: any;
  let clockAttempts: any;
  let service: ManagerService;

  const manager = { id: 'mgr1', role: Role.MANAGER, locationId: 'gaia' };
  const employee = { id: 'emp1', isActive: true, locationId: 'gaia' };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(where.id === 'mgr1' ? manager : employee),
        ),
        findMany: jest.fn(),
      },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockResolvedValue({
            id: 'att1',
            clockIn: new Date(),
            methodIn: AttendanceMethod.MANAGER_OVERRIDE,
          }),
      },
      clockAttempt: { findMany: jest.fn().mockResolvedValue([]) },
      managerOverrideAudit: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    clockAttempts = {
      getQualifyingLocations: jest.fn(),
      resolveFailedClockIns: jest.fn().mockResolvedValue({ count: 3 }),
    };
    service = new ManagerService(
      prisma as unknown as PrismaService,
      clockAttempts as unknown as ClockAttemptService,
    );
  });

  it('rejects when fewer than 3 qualifying failed attempts exist', async () => {
    clockAttempts.getQualifyingLocations.mockResolvedValue([]);
    await expect(
      service.managerClockIn('mgr1', 'emp1', { reason: 'phone dead' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it('rejects when the employee is already clocked in', async () => {
    prisma.attendance.findFirst.mockResolvedValue({ id: 'open' });
    clockAttempts.getQualifyingLocations.mockResolvedValue([
      { locationId: 'gaia', attemptIds: ['a1', 'a2', 'a3'], count: 3 },
    ]);
    await expect(
      service.managerClockIn('mgr1', 'emp1', { reason: 'phone dead' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a reason', async () => {
    await expect(
      service.managerClockIn('mgr1', 'emp1', { reason: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the qualifying location is NOT one the manager manages', async () => {
    // Failures happened at St Regis, but this manager only manages GAIA.
    clockAttempts.getQualifyingLocations.mockResolvedValue([
      { locationId: 'stregis', attemptIds: ['a1', 'a2', 'a3'], count: 3 },
    ]);
    await expect(
      service.managerClockIn('mgr1', 'emp1', { reason: 'phone dead' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a MANAGER_OVERRIDE attendance, resolves the sequence and writes a permanent audit', async () => {
    clockAttempts.getQualifyingLocations.mockResolvedValue([
      { locationId: 'gaia', attemptIds: ['a1', 'a2', 'a3'], count: 3 },
    ]);

    const result = await service.managerClockIn('mgr1', 'emp1', {
      reason: 'phone battery dead',
    });

    expect(result.success).toBe(true);
    expect(prisma.attendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'emp1',
        methodIn: AttendanceMethod.MANAGER_OVERRIDE,
        clockInLocationId: 'gaia',
        isEdited: true,
      }),
    });
    expect(clockAttempts.resolveFailedClockIns).toHaveBeenCalledWith(
      'emp1',
      'att1',
      prisma,
    );
    expect(prisma.managerOverrideAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp1',
        managerId: 'mgr1',
        attendanceId: 'att1',
        locationId: 'gaia',
        reason: 'phone battery dead',
        qualifyingFailedAttempts: 3,
      }),
    });
  });
});

describe('ManagerService — live attendance availability', () => {
  let prisma: any;
  let clockAttempts: any;
  let service: ManagerService;

  const manager = { id: 'mgr1', role: Role.MANAGER, locationId: 'gaia' };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(manager),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'emp1', fullName: 'Ana', location: { id: 'gaia', name: 'GAIA' } },
          ]),
      },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      clockAttempt: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'emp1', locationId: 'gaia' },
          { userId: 'emp1', locationId: 'gaia' },
          { userId: 'emp1', locationId: 'gaia' },
        ]),
      },
    };
    clockAttempts = {};
    service = new ManagerService(
      prisma as unknown as PrismaService,
      clockAttempts as unknown as ClockAttemptService,
    );
  });

  it('marks managerClockInAvailable=true when 3+ failures at the managed location and not clocked in', async () => {
    const res = await service.getLiveAttendance('mgr1');
    expect(res.employees).toHaveLength(1);
    expect(res.employees[0].failedClockInAttempts).toBe(3);
    expect(res.employees[0].managerClockInAvailable).toBe(true);
    expect(res.employees[0].currentStatus).toBe('NEVER');
  });
});
