import { Role } from '@prisma/client';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { ManagerService } from './manager.service';

/**
 * Live dashboard: KPI counts, newest-first ordering, per-company chips
 * (independent of the company filter), and filter application.
 */
describe('ManagerService.getLiveDashboard', () => {
  let prisma: any;
  let service: ManagerService;

  const now = Date.now();
  const min = (m: number) => new Date(now - m * 60 * 1000);

  // Row A: U1 @ AG — clocked in and out today.
  const rowA = {
    id: 'a1',
    userId: 'u1',
    clockIn: min(15),
    clockOut: min(5),
    methodIn: 'CARD',
    methodOut: 'CARD',
    clockInLocationId: 'gaia',
    clockOutLocationId: 'gaia',
    companyId: 'C1',
    user: { id: 'u1', fullName: 'Nikolas', companyId: 'C1', company: { id: 'C1', name: 'AG Agathokleous' } },
    company: { id: 'C1', name: 'AG Agathokleous' },
    clockInLocation: { id: 'gaia', name: 'GAIA' },
    clockOutLocation: { id: 'gaia', name: 'GAIA' },
    kioskIn: { id: 'k1', name: 'GAIA-KIOSK-01' },
    kioskOut: null,
  };
  // Row B: U2 @ Marfields — clocked in today, still open.
  const rowB = {
    id: 'b1',
    userId: 'u2',
    clockIn: min(10),
    clockOut: null,
    methodIn: 'MOBILE_QR',
    methodOut: null,
    clockInLocationId: 'ho',
    clockOutLocationId: null,
    companyId: 'C2',
    user: { id: 'u2', fullName: 'Maria', companyId: 'C2', company: { id: 'C2', name: 'Marfields' } },
    company: { id: 'C2', name: 'Marfields' },
    clockInLocation: { id: 'ho', name: 'Head Office' },
    clockOutLocation: null,
    kioskIn: null,
    kioskOut: null,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'mgr', role: Role.ADMIN, locationId: null }),
      },
      attendance: {
        findMany: jest.fn((args: any) =>
          Promise.resolve(args?.where?.clockOut === null ? [rowB] : [rowA, rowB]),
        ),
      },
    };
    service = new ManagerService(
      prisma as unknown as PrismaService,
      {} as unknown as ClockAttemptService,
    );
  });

  it('computes KPI totals correctly (unfiltered)', async () => {
    const res = await service.getLiveDashboard('mgr', {});
    expect(res.summary).toEqual({
      activeNow: 1, // U2 open
      totalToday: 2, // U1 + U2
      clockInsToday: 2, // A-in + B-in
      clockOutsToday: 1, // A-out
    });
  });

  it('orders events newest-first with the latest event highlighted', async () => {
    const res = await service.getLiveDashboard('mgr', {});
    expect(res.events).toHaveLength(3);
    expect(res.events[0].type).toBe('CLOCK_OUT'); // A-out @ -5min is newest
    expect(res.events[0].employeeName).toBe('Nikolas');
    expect(res.latestEvent?.attendanceId).toBe('a1');
    // strictly descending by time
    const times = res.events.map((e) => new Date(e.time).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('returns per-company chips independent of the company filter', async () => {
    const res = await service.getLiveDashboard('mgr', { companyId: 'C2' });
    // Feed + KPIs reflect the C2 filter...
    expect(res.summary.totalToday).toBe(1);
    expect(res.summary.clockInsToday).toBe(1);
    expect(res.summary.clockOutsToday).toBe(0);
    expect(res.summary.activeNow).toBe(1);
    expect(res.events.every((e) => e.companyId === 'C2')).toBe(true);
    // ...but chips still list BOTH companies with their own counts.
    const byId = Object.fromEntries(res.companies.map((c) => [c.companyId, c]));
    expect(byId['C1']).toMatchObject({ activeNow: 0, totalToday: 1 });
    expect(byId['C2']).toMatchObject({ activeNow: 1, totalToday: 1 });
  });

  it('filters the feed by event type', async () => {
    const res = await service.getLiveDashboard('mgr', { type: 'CLOCK_OUT' });
    expect(res.events).toHaveLength(1);
    expect(res.events[0].type).toBe('CLOCK_OUT');
  });
});
