import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';

/**
 * Focused unit tests for AttendanceService.getStatus (no side-effect deps).
 * The clock-in/out geolocation behaviour is covered by attendance.clockout.spec
 * and attendance.mixed-method.spec; this suite keeps the service under direct
 * test without a DB.
 */
describe('AttendanceService.getStatus', () => {
  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = { attendance: { findFirst: jest.fn() } };
    const clockAttempts = {
      resolveFailedClockIns: jest.fn().mockResolvedValue({ count: 0 }),
    } as unknown as ClockAttemptService;
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      clockAttempts,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('reports not-clocked-in when there is no open record', async () => {
    prisma.attendance.findFirst.mockResolvedValue(null);
    const res = await service.getStatus('u1');
    expect(res.isClockedIn).toBe(false);
    expect(res.canClockIn).toBe(true);
    expect(prisma.attendance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', clockOut: null } }),
    );
  });

  it('reports clocked-in when an open record exists', async () => {
    prisma.attendance.findFirst.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      clockIn: new Date(Date.now() - 60 * 60 * 1000),
      clockOut: null,
    });
    const res = await service.getStatus('u1');
    expect(res.isClockedIn).toBe(true);
    expect(res.canClockIn).toBe(false);
  });
});
