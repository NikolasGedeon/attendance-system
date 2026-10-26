import {
  AttendanceAutoCloseService,
  cyprusEndOfDay,
} from './attendance-autoclose.service';

/**
 * Cyprus is UTC+3 (EEST) in summer and UTC+2 (EET) in winter; the switch is
 * the last Sunday of October at 04:00 local. Every instant below is written
 * as UTC so the expected values stay unambiguous.
 */
function makeService(open: any[], updateCount = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
  const prisma: any = {
    attendance: {
      findMany: jest.fn().mockResolvedValue(open),
      updateMany,
    },
  };
  return {
    service: new AttendanceAutoCloseService(prisma),
    updateMany,
  };
}

const internal = (clockIn: string, id = 'a1') => ({
  id,
  clockIn: new Date(clockIn),
  userId: 'U1',
  user: { employeeType: 'INTERNAL' },
});

const external = (clockIn: string, id = 'a1') => ({
  id,
  clockIn: new Date(clockIn),
  userId: 'U2',
  user: { employeeType: 'EXTERNAL' },
});

describe('cyprusEndOfDay', () => {
  it('summer (UTC+3): 16:00 Cyprus closes at 21:00Z the same day', () => {
    expect(cyprusEndOfDay(new Date('2026-07-22T13:00:00Z')).toISOString()).toBe(
      '2026-07-22T21:00:00.000Z',
    );
  });

  it('winter (UTC+2): closes at 22:00Z', () => {
    expect(cyprusEndOfDay(new Date('2026-11-10T09:00:00Z')).toISOString()).toBe(
      '2026-11-10T22:00:00.000Z',
    );
  });

  it('the day DST ends is still UTC+3 at midnight', () => {
    expect(cyprusEndOfDay(new Date('2026-10-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-24T21:00:00.000Z',
    );
  });

  it('just before Cyprus midnight still ends that same day', () => {
    // 23:30 Cyprus on 22 July = 20:30Z
    expect(cyprusEndOfDay(new Date('2026-07-22T20:30:00Z')).toISOString()).toBe(
      '2026-07-22T21:00:00.000Z',
    );
  });
});

describe('AttendanceAutoCloseService', () => {
  const NOW = new Date('2026-10-26T09:00:00Z');

  it('closes an INTERNAL shift at midnight of the day it STARTED', async () => {
    const { service, updateMany } = makeService([
      internal('2026-07-22T13:00:00Z'),
    ]);
    const result = await service.run(NOW);

    expect(result.internalClosed).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', clockOut: null },
      data: {
        clockOut: new Date('2026-07-22T21:00:00.000Z'),
        methodOut: 'AUTO_CLOSE',
      },
    });
  });

  it('does NOT bank the whole backlog: a 3-month-old open shift still closes on its own first day', async () => {
    const { service, updateMany } = makeService([
      internal('2026-08-27T13:22:00Z'),
    ]);
    await service.run(NOW);

    const written = updateMany.mock.calls[0][0].data.clockOut as Date;
    const hours =
      (written.getTime() - new Date('2026-08-27T13:22:00Z').getTime()) / 3600_000;
    expect(hours).toBeLessThan(24);
  });

  it('leaves a genuine EXTERNAL night shift alone', async () => {
    // Security clocks in 21:00 Cyprus, job runs at the following midnight.
    const { service, updateMany } = makeService([
      external('2026-10-25T19:00:00Z'),
    ]);
    const result = await service.run(new Date('2026-10-25T22:00:00Z'));

    expect(result.externalClosed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('closes an EXTERNAL shift that ran past the cap, at clockIn + cap', async () => {
    const { service, updateMany } = makeService([
      external('2026-10-20T19:00:00Z'),
    ]);
    const result = await service.run(NOW);

    expect(result.externalClosed).toBe(1);
    expect(updateMany.mock.calls[0][0].data.clockOut).toEqual(
      new Date('2026-10-21T11:00:00.000Z'), // +16h
    );
  });

  it('honours AUTO_CLOSE_EXTERNAL_MAX_HOURS', async () => {
    process.env.AUTO_CLOSE_EXTERNAL_MAX_HOURS = '10';
    try {
      const { service, updateMany } = makeService([
        external('2026-10-20T19:00:00Z'),
      ]);
      await service.run(NOW);
      expect(updateMany.mock.calls[0][0].data.clockOut).toEqual(
        new Date('2026-10-21T05:00:00.000Z'), // +10h
      );
    } finally {
      delete process.env.AUTO_CLOSE_EXTERNAL_MAX_HOURS;
    }
  });

  it('never writes a clockOut in the future', async () => {
    const { service, updateMany } = makeService([
      internal('2026-10-26T08:00:00Z'), // today, still running
    ]);
    const result = await service.run(NOW);

    expect(updateMany).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('does not overwrite a shift the employee closed in the meantime', async () => {
    const { service } = makeService([internal('2026-07-22T13:00:00Z')], 0);
    const result = await service.run(NOW);

    expect(result.internalClosed).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('treats a user with no employeeType as INTERNAL', async () => {
    const { service, updateMany } = makeService([
      { id: 'a9', clockIn: new Date('2026-07-22T13:00:00Z'), userId: 'U9', user: null },
    ]);
    const result = await service.run(NOW);

    expect(result.internalClosed).toBe(1);
    expect(updateMany.mock.calls[0][0].data.clockOut).toEqual(
      new Date('2026-07-22T21:00:00.000Z'),
    );
  });

  it('can be disabled without a deploy', async () => {
    process.env.AUTO_CLOSE_ENABLED = 'false';
    try {
      const { service, updateMany } = makeService([
        internal('2026-07-22T13:00:00Z'),
      ]);
      await service.handleNightlyAutoClose();
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      delete process.env.AUTO_CLOSE_ENABLED;
    }
  });
});
