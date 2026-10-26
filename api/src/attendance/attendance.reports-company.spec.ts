import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';

/**
 * Company filtering on the basic daily/monthly reports. The filter is applied
 * server-side against the employee's current company and combines with the
 * date range.
 */
describe('AttendanceService — daily/monthly company filter', () => {
  let prisma: any;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = { attendance: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      { resolveFailedClockIns: jest.fn() } as unknown as ClockAttemptService,
    );
  });

  it('monthly report applies the company filter via the user relation', async () => {
    await service.getMonthlyReport(2026, 7, 'c1');
    const where = prisma.attendance.findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ companyId: 'c1' });
  });

  it('monthly report has no user filter when no company is given', async () => {
    await service.getMonthlyReport(2026, 7);
    const where = prisma.attendance.findMany.mock.calls[0][0].where;
    expect(where.user).toBeUndefined();
  });

  it('daily report applies the company filter via the user relation', async () => {
    await service.getDailyReport('2026-07-30', 'c1');
    const where = prisma.attendance.findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ companyId: 'c1' });
  });

  it('daily report has no user filter when no company is given', async () => {
    await service.getDailyReport('2026-07-30');
    const where = prisma.attendance.findMany.mock.calls[0][0].where;
    expect(where.user).toBeUndefined();
  });
});
