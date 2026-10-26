import { AttendanceMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockAttemptService } from '../clock-attempt/clock-attempt.service';
import { AttendanceService } from './attendance.service';

/**
 * Stage 7: employee-app GPS clock-in/out must stamp methodIn/methodOut =
 * MOBILE_GPS (previously left null). Kiosk methods are unaffected.
 */
describe('AttendanceService — mobile GPS method', () => {
  let prisma: any;
  let service: AttendanceService;

  // Location the employee is standing inside (distance 0, radius 150).
  const userWithLocation = {
    id: 'u1',
    companyId: null,
    location: {
      id: 'l1',
      name: 'HQ',
      latitude: 34.7071,
      longitude: 33.0226,
      radiusMeters: 150,
      isActive: true,
    },
  };

  beforeEach(() => {
    prisma = {
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'a1', clockIn: new Date() }),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'a1',
          clockIn: new Date(),
          ...data,
        })),
      },
      user: { findUnique: jest.fn().mockResolvedValue(userWithLocation) },
    };
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      { resolveFailedClockIns: jest.fn() } as unknown as ClockAttemptService,
    );
  });

  it('clock-in stores MOBILE_GPS', async () => {
    await service.clockIn('u1', 34.7071, 33.0226);
    expect(prisma.attendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ methodIn: AttendanceMethod.MOBILE_GPS }),
      }),
    );
  });

  it('clock-out stores MOBILE_GPS', async () => {
    prisma.attendance.findFirst.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      clockIn: new Date(Date.now() - 3600 * 1000),
      clockOut: null,
    });
    await service.clockOut('u1', { latitude: 34.7071, longitude: 33.0226 });
    const data = prisma.attendance.update.mock.calls[0][0].data;
    expect(data.methodOut).toBe(AttendanceMethod.MOBILE_GPS);
  });
});
