import { AttendanceOtpAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClockAttemptService,
  FAILED_CLOCK_IN_THRESHOLD,
} from './clock-attempt.service';

describe('ClockAttemptService (failed-attempt eligibility rule)', () => {
  let prisma: any;
  let service: ClockAttemptService;

  beforeEach(() => {
    prisma = {
      clockAttempt: {
        create: jest.fn().mockResolvedValue({ id: 'ca1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        findMany: jest.fn(),
      },
    };
    service = new ClockAttemptService(prisma as unknown as PrismaService);
  });

  it('records ONLY failed CLOCK_IN attempts', async () => {
    await service.recordFailedClockIn({
      userId: 'u1',
      kioskId: 'k1',
      locationId: 'gaia',
      reason: 'CARD_OTP_FAILED',
    });
    expect(prisma.clockAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        kioskId: 'k1',
        locationId: 'gaia',
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
      }),
    });
  });

  it('only counts unresolved recent failed CLOCK_IN (query filters)', async () => {
    prisma.clockAttempt.findMany.mockResolvedValue([]);
    await service.listQualifyingFailedClockIns('u1');
    const where = prisma.clockAttempt.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        userId: 'u1',
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
        resolvedAt: null,
      }),
    );
    // A 15-minute lower bound must be applied.
    expect(where.attemptedAt).toHaveProperty('gte');
    expect(where.attemptedAt.gte).toBeInstanceOf(Date);
  });

  it('qualifies a location only at >= threshold failures at the SAME location', async () => {
    // 3 at GAIA, 2 at St Regis
    prisma.clockAttempt.findMany.mockResolvedValue([
      { id: 'a1', locationId: 'gaia' },
      { id: 'a2', locationId: 'gaia' },
      { id: 'a3', locationId: 'gaia' },
      { id: 'a4', locationId: 'stregis' },
      { id: 'a5', locationId: 'stregis' },
    ]);
    const result = await service.getQualifyingLocations('u1');
    expect(result).toHaveLength(1);
    expect(result[0].locationId).toBe('gaia');
    expect(result[0].count).toBe(FAILED_CLOCK_IN_THRESHOLD);
    expect(result[0].attemptIds).toEqual(['a1', 'a2', 'a3']);
  });

  it('does not qualify when failures are split across locations', async () => {
    prisma.clockAttempt.findMany.mockResolvedValue([
      { id: 'a1', locationId: 'gaia' },
      { id: 'a2', locationId: 'gaia' },
      { id: 'a3', locationId: 'stregis' },
      { id: 'a4', locationId: 'stregis' },
    ]);
    const result = await service.getQualifyingLocations('u1');
    expect(result).toHaveLength(0);
  });

  it('resolveFailedClockIns marks the outstanding sequence resolved', async () => {
    await service.resolveFailedClockIns('u1', 'att-123');
    expect(prisma.clockAttempt.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'u1',
        action: AttendanceOtpAction.CLOCK_IN,
        successful: false,
        resolvedAt: null,
      }),
      data: expect.objectContaining({ resolvedById: 'att-123' }),
    });
  });
});
