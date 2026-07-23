import {
  DAILY_BREAK_SECONDS,
  aggregateDay,
  csvCell,
  cyprusDate,
  dailyBreakSeconds,
  dailyNetSeconds,
  formatDuration,
  secondsToDecimalHours,
  secondsToExcelDuration,
} from './report-policy.util';

const D = (iso: string) => new Date(iso);

describe('report-policy.util — duration formatting', () => {
  it('formats HH:mm', () => {
    expect(formatDuration(1800)).toBe('00:30'); // 30 min
    expect(formatDuration(5400)).toBe('01:30'); // 1h30
    expect(formatDuration(29700)).toBe('08:15'); // 8h15
    expect(formatDuration(158220)).toBe('43:57'); // >24h
  });

  it('formats HH:mm:ss when requested', () => {
    expect(formatDuration(3528, true)).toBe('00:58:48'); // 58m48s
  });

  it('never renders negative durations', () => {
    expect(formatDuration(-500)).toBe('00:00');
  });

  it('converts seconds to an Excel day-fraction', () => {
    expect(secondsToExcelDuration(3600)).toBeCloseTo(1 / 24, 10);
    expect(secondsToExcelDuration(2700)).toBeCloseTo(0.03125, 10);
    expect(secondsToExcelDuration(86400)).toBe(1);
  });

  it('derives backward-compat decimal hours (2dp) once', () => {
    expect(secondsToDecimalHours(18900)).toBe(5.25); // 05:15
    expect(secondsToDecimalHours(3528)).toBe(0.98); // the old "0.98"
  });
});

describe('report-policy.util — automatic 45-minute daily break', () => {
  it('deducts 45 min for a 6-hour day', () => {
    expect(dailyBreakSeconds(21600)).toBe(2700);
    expect(dailyNetSeconds(21600)).toBe(18900); // 05:15
  });

  it('deducts 45 min for a 5-hour day', () => {
    expect(dailyBreakSeconds(18000)).toBe(2700);
    expect(dailyNetSeconds(18000)).toBe(15300); // 04:15
  });

  it('caps the break at gross for a sub-45-minute day (net never negative)', () => {
    expect(dailyBreakSeconds(1800)).toBe(1800); // 30 min
    expect(dailyNetSeconds(1800)).toBe(0);
  });

  it('applies no break when there is no completed gross time', () => {
    expect(dailyBreakSeconds(0)).toBe(0);
    expect(dailyNetSeconds(0)).toBe(0);
  });

  it('uses the confirmed 2700-second policy constant', () => {
    expect(DAILY_BREAK_SECONDS).toBe(2700);
  });
});

describe('report-policy.util — Cyprus (Europe/Nicosia) date grouping', () => {
  it('maps a late-evening UTC instant to the next Cyprus day (summer +3)', () => {
    expect(cyprusDate(D('2026-07-15T21:30:00Z'))).toBe('2026-07-16');
  });
  it('maps a late-evening UTC instant to the next Cyprus day (winter +2)', () => {
    expect(cyprusDate(D('2026-01-15T22:30:00Z'))).toBe('2026-01-16');
  });
  it('keeps a daytime instant on the same Cyprus day', () => {
    expect(cyprusDate(D('2026-07-15T05:00:00Z'))).toBe('2026-07-15');
  });
});

describe('report-policy.util — aggregateDay', () => {
  it('sums two completed sessions and deducts one break (MULTIPLE_RECORDS)', () => {
    const day = aggregateDay([
      { id: 's1', clockIn: D('2026-07-15T04:00:00Z'), clockOut: D('2026-07-15T07:00:00Z') },
      { id: 's2', clockIn: D('2026-07-15T08:00:00Z'), clockOut: D('2026-07-15T11:00:00Z') },
    ]);
    expect(day.grossSeconds).toBe(21600); // 6h
    expect(day.breakSeconds).toBe(2700); // once
    expect(day.netSeconds).toBe(18900); // 05:15
    expect(day.completedCount).toBe(2);
    expect(day.statuses).toContain('MULTIPLE_RECORDS');
  });

  it('flags an open-only day with no gross/break/net', () => {
    const day = aggregateDay([
      { id: 'o1', clockIn: D('2026-07-15T05:00:00Z'), clockOut: null },
    ]);
    expect(day.grossSeconds).toBe(0);
    expect(day.breakSeconds).toBe(0);
    expect(day.netSeconds).toBe(0);
    expect(day.hasOpenRecord).toBe(true);
    expect(day.statuses).toContain('OPEN_RECORD');
  });

  it('excludes a negative-duration session and flags it (not silently summed)', () => {
    const day = aggregateDay([
      { id: 'bad', clockIn: D('2026-07-15T10:00:00Z'), clockOut: D('2026-07-15T09:00:00Z') },
    ]);
    expect(day.grossSeconds).toBe(0);
    expect(day.statuses).toContain('INVALID_DURATION');
    expect(day.statuses).toContain('CLOCK_OUT_BEFORE_CLOCK_IN');
  });

  it('flags an overnight shift but still counts its real duration', () => {
    const day = aggregateDay([
      { id: 'ov', clockIn: D('2026-07-15T20:00:00Z'), clockOut: D('2026-07-15T22:00:00Z') },
    ]);
    // 23:00 -> 01:00 Cyprus, 2h elapsed, crosses the Cyprus date boundary.
    expect(day.grossSeconds).toBe(7200);
    expect(day.statuses).toContain('OVERNIGHT_SHIFT');
  });

  it('flags overlapping sessions', () => {
    const day = aggregateDay([
      { id: 'a', clockIn: D('2026-07-15T04:00:00Z'), clockOut: D('2026-07-15T07:00:00Z') },
      { id: 'b', clockIn: D('2026-07-15T06:00:00Z'), clockOut: D('2026-07-15T08:00:00Z') },
    ]);
    expect(day.statuses).toContain('OVERLAPPING_RECORDS');
  });

  it('flags a manually adjusted session', () => {
    const day = aggregateDay([
      {
        id: 'm',
        clockIn: D('2026-07-15T04:00:00Z'),
        clockOut: D('2026-07-15T05:00:00Z'),
        isEdited: true,
      },
    ]);
    expect(day.statuses).toContain('MANUALLY_ADJUSTED');
  });
});

describe('report-policy.util — CSV formula-injection safety', () => {
  it('neutralises leading formula characters', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@x')).toBe("'@x");
  });
  it('quotes values containing commas or quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('leaves ordinary values unchanged', () => {
    expect(csvCell('Alice Example')).toBe('Alice Example');
    expect(csvCell(null)).toBe('');
  });
});
