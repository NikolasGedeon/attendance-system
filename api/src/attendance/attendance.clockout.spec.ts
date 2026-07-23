import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AttendanceService } from './attendance.service';
import { ClockOutDto } from './dto/clock-out.dto';

// Assigned location: Nicosia HQ, 150m radius.
const HQ = {
  id: 'loc-1',
  name: 'HQ',
  latitude: 34.9013,
  longitude: 33.62,
  radiusMeters: 150,
  isActive: true,
};
const INSIDE = { latitude: 34.9014, longitude: 33.6201 }; // ~15m from HQ
const OUTSIDE = { latitude: 34.95, longitude: 33.7 }; // several km away

function makeService(opts: {
  open?: any;
  location?: any;
  updateSpy?: jest.Mock;
} = {}) {
  const open =
    opts.open === undefined
      ? { id: 'att-1', userId: 'U1', clockIn: new Date('2026-07-22T05:00:00Z'), clockOut: null, latitude: 34.9013, longitude: 33.62 }
      : opts.open;
  const location = opts.location === undefined ? HQ : opts.location;
  const update =
    opts.updateSpy ??
    jest.fn().mockImplementation(({ data }) => ({ id: 'att-1', clockIn: open?.clockIn, ...data }));
  const prisma: any = {
    attendance: {
      findFirst: jest.fn().mockResolvedValue(open),
      update,
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(
        location === null ? { id: 'U1', location: null } : { id: 'U1', location },
      ),
    },
  };
  return { service: new AttendanceService(prisma), update, prisma };
}

const nowIso = () => new Date().toISOString();
async function code(fn: () => Promise<any>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e: any) {
    const r = e?.getResponse?.();
    return r?.code ?? e?.constructor?.name;
  }
}

describe('AttendanceService.clockOut — mobile geolocation enforcement', () => {
  it('1. succeeds inside the geofence and returns the record', async () => {
    const { service, update } = makeService();
    const res: any = await service.clockOut('U1', {
      latitude: INSIDE.latitude,
      longitude: INSIDE.longitude,
      accuracyMeters: 12,
      capturedAt: nowIso(),
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(res.clockOutGeofenceStatus).toBe('INSIDE');
  });

  it('2/3. missing latitude or longitude -> LOCATION_REQUIRED', async () => {
    expect(await code(() => makeService().service.clockOut('U1', { longitude: 33.62 }))).toBe('LOCATION_REQUIRED');
    expect(await code(() => makeService().service.clockOut('U1', { latitude: 34.9 }))).toBe('LOCATION_REQUIRED');
  });

  it('4/5. out-of-range coordinates -> LOCATION_INVALID', async () => {
    expect(await code(() => makeService().service.clockOut('U1', { latitude: 999, longitude: 33.62, capturedAt: nowIso() }))).toBe('LOCATION_INVALID');
    expect(await code(() => makeService().service.clockOut('U1', { latitude: 34.9, longitude: 500, capturedAt: nowIso() }))).toBe('LOCATION_INVALID');
  });

  it('7. stale GPS fix -> LOCATION_TOO_OLD', async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min
    expect(await code(() => makeService().service.clockOut('U1', { ...INSIDE, capturedAt: old }))).toBe('LOCATION_TOO_OLD');
  });

  it('8. materially future GPS fix -> LOCATION_TIMESTAMP_IN_FUTURE', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // +5 min
    expect(await code(() => makeService().service.clockOut('U1', { ...INSIDE, capturedAt: future }))).toBe('LOCATION_TIMESTAMP_IN_FUTURE');
  });

  it('9. outside the geofence -> LOCATION_OUTSIDE_GEOFENCE', async () => {
    expect(await code(() => makeService().service.clockOut('U1', { ...OUTSIDE, capturedAt: nowIso() }))).toBe('LOCATION_OUTSIDE_GEOFENCE');
  });

  it('10. no assigned location -> NO_ASSIGNED_LOCATION', async () => {
    expect(await code(() => makeService({ location: null }).service.clockOut('U1', { ...INSIDE, capturedAt: nowIso() }))).toBe('NO_ASSIGNED_LOCATION');
  });

  it('11. inactive assigned location -> LOCATION_INACTIVE', async () => {
    expect(await code(() => makeService({ location: { ...HQ, isActive: false } }).service.clockOut('U1', { ...INSIDE, capturedAt: nowIso() }))).toBe('LOCATION_INACTIVE');
  });

  it('12/13. stores clock-out coords; does NOT touch clock-in coords', async () => {
    const { service, update } = makeService();
    await service.clockOut('U1', { latitude: INSIDE.latitude, longitude: INSIDE.longitude, accuracyMeters: 9.5, capturedAt: nowIso() });
    const data = update.mock.calls[0][0].data;
    expect(data.clockOutLatitude).toBe(INSIDE.latitude);
    expect(data.clockOutLongitude).toBe(INSIDE.longitude);
    expect(data.clockOutAccuracyMeters).toBe(9.5);
    expect(data.clockOutLocationId).toBe('loc-1');
    expect('latitude' in data).toBe(false); // clock-in latitude untouched
    expect('longitude' in data).toBe(false);
  });

  it('14. official clockOut uses SERVER time, not capturedAt', async () => {
    const { service, update } = makeService();
    const captured = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago
    await service.clockOut('U1', { ...INSIDE, capturedAt: captured });
    const data = update.mock.calls[0][0].data;
    expect(data.clockOut instanceof Date).toBe(true);
    expect(Math.abs(Date.now() - data.clockOut.getTime())).toBeLessThan(5000);
    expect(data.clockOut.toISOString()).not.toBe(captured);
    // capturedAt is stored separately as the GPS-fix time.
    expect(data.clockOutCapturedAt.toISOString()).toBe(captured);
  });

  it('15. closes the open attendance by id', async () => {
    const { service, update } = makeService();
    await service.clockOut('U1', { ...INSIDE, capturedAt: nowIso() });
    expect(update.mock.calls[0][0].where).toEqual({ id: 'att-1' });
  });

  it('16. no open attendance -> existing NotFound error', async () => {
    const { service } = makeService({ open: null });
    await expect(service.clockOut('U1', { ...INSIDE, capturedAt: nowIso() })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rollout flag REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION=false skips enforcement (legacy)', async () => {
    const prev = process.env.REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION;
    process.env.REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION = 'false';
    try {
      const { service, update } = makeService();
      await service.clockOut('U1', {}); // no coords
      const data = update.mock.calls[0][0].data;
      expect(data.clockOut instanceof Date).toBe(true);
      expect('clockOutLatitude' in data).toBe(false);
    } finally {
      process.env.REQUIRE_MOBILE_CLOCKOUT_GEOLOCATION = prev;
    }
  });
});

describe('ClockOutDto validation (type-level)', () => {
  const bad = async (obj: any) =>
    (await validate(plainToInstance(ClockOutDto, obj))).length > 0;

  it('6. rejects negative accuracy', async () => {
    expect(await bad({ latitude: 34.9, longitude: 33.6, accuracyMeters: -5 })).toBe(true);
  });
  it('rejects NaN / Infinity / string coordinates', async () => {
    expect(await bad({ latitude: NaN, longitude: 33.6 })).toBe(true);
    expect(await bad({ latitude: Infinity, longitude: 33.6 })).toBe(true);
    expect(await bad({ latitude: '34.9', longitude: 33.6 })).toBe(true);
  });
  it('rejects malformed capturedAt', async () => {
    expect(await bad({ latitude: 34.9, longitude: 33.6, capturedAt: 'not-a-date' })).toBe(true);
  });
  it('accepts a well-formed payload', async () => {
    expect(await bad({ latitude: 34.9, longitude: 33.6, accuracyMeters: 10, capturedAt: nowIso() })).toBe(false);
  });
});
