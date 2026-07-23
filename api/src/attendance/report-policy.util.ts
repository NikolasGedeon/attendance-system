/**
 * Shared attendance report calculation & formatting policy.
 *
 * Single source of truth for:
 *  - Cyprus (Europe/Nicosia) business-day grouping and time formatting;
 *  - the automatic daily break (09:00-09:15 + 12:00-12:30 = 45 minutes);
 *  - integer-second aggregation (no repeated decimal-hour rounding);
 *  - attendance session validity + exception detection;
 *  - human-readable duration formatting (HH:mm / HH:mm:ss);
 *  - Excel numeric duration values ([h]:mm) and CSV formula-injection safety.
 *
 * Pure functions only — no database access — so it is fully unit-testable and
 * can be reused by every report (advanced, absence, daily, monthly) in later
 * stages without duplicating the policy.
 */

/** Business timezone for ALL report date grouping and displayed times. */
export const REPORT_TZ = 'Europe/Nicosia';

/** Automatic unpaid daily break: 09:00-09:15 (15m) + 12:00-12:30 (30m) = 45m. */
export const DAILY_BREAK_SECONDS = 45 * 60; // 2700

/** Displayed break-policy description (business-confirmed wording). */
export const BREAK_POLICY_TEXT =
  'Automatic daily break deduction: 45 minutes\n(09:00-09:15 and 12:00-12:30)';

export const SECONDS_PER_DAY = 86400;

export type ExceptionCode =
  | 'OPEN_RECORD'
  | 'INVALID_DURATION'
  | 'CLOCK_OUT_BEFORE_CLOCK_IN'
  | 'OVERNIGHT_SHIFT'
  | 'OVERLAPPING_RECORDS'
  | 'MULTIPLE_RECORDS'
  | 'MANUALLY_ADJUSTED';

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** YYYY-MM-DD in the Cyprus business timezone. */
export function cyprusDate(date: Date): string {
  return DATE_FMT.format(date);
}

/** HH:mm in the Cyprus business timezone. */
export function cyprusTime(date: Date): string {
  return TIME_FMT.format(date);
}

/** Integer seconds between two instants (negative if `to` precedes `from`). */
export function diffSeconds(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 1000);
}

/** Human-readable "HH:mm" (or "HH:mm:ss"); hours may exceed 24. */
export function formatDuration(totalSeconds: number, withSeconds = false): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  if (withSeconds) {
    return `${hh}:${mm}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${hh}:${mm}`;
}

/** Excel serial fraction of a day for a duration (value = seconds / 86400). */
export function secondsToExcelDuration(totalSeconds: number): number {
  return Math.max(0, totalSeconds) / SECONDS_PER_DAY;
}

/** Backward-compat decimal hours (2dp), derived ONCE from integer seconds. */
export function secondsToDecimalHours(totalSeconds: number): number {
  return Math.round((Math.max(0, totalSeconds) / 3600) * 100) / 100;
}

/** Automatic daily break: 45 min once, capped at gross, 0 when no gross. */
export function dailyBreakSeconds(grossSeconds: number): number {
  return grossSeconds > 0 ? Math.min(DAILY_BREAK_SECONDS, grossSeconds) : 0;
}

/** Net = gross - break, never negative. */
export function dailyNetSeconds(grossSeconds: number): number {
  return Math.max(0, grossSeconds - dailyBreakSeconds(grossSeconds));
}

// ---------------------------------------------------------------------------
// Session / day aggregation
// ---------------------------------------------------------------------------

export interface RawSession {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  methodIn?: string | null;
  methodOut?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isEdited?: boolean;
}

export interface SessionResult {
  id: string;
  clockIn: string; // ISO
  clockInLocal: string; // HH:mm Cyprus
  clockOut: string | null; // ISO
  clockOutLocal: string | null; // HH:mm Cyprus
  durationSeconds: number; // 0 for open / invalid
  durationDisplay: string; // HH:mm
  methodIn: string | null;
  methodOut: string | null;
  latitude: number | null;
  longitude: number | null;
  isEdited: boolean;
  open: boolean;
  valid: boolean; // completed & non-negative
  statuses: ExceptionCode[];
}

export interface DayResult {
  grossSeconds: number;
  breakSeconds: number;
  netSeconds: number;
  completedCount: number;
  openCount: number;
  recordsCount: number;
  firstClockIn: string | null; // HH:mm
  finalClockOut: string | null; // HH:mm
  hasOpenRecord: boolean;
  methods: string[];
  statuses: ExceptionCode[]; // day-level exception set
  sessions: SessionResult[];
}

/** Classify a single raw session (validity, duration, per-session flags). */
export function classifySession(raw: RawSession): SessionResult {
  const statuses: ExceptionCode[] = [];
  const base = {
    id: raw.id,
    clockIn: raw.clockIn.toISOString(),
    clockInLocal: cyprusTime(raw.clockIn),
    methodIn: raw.methodIn ?? null,
    methodOut: raw.methodOut ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    isEdited: raw.isEdited === true,
  };
  if (base.isEdited) statuses.push('MANUALLY_ADJUSTED');

  if (!raw.clockOut) {
    statuses.unshift('OPEN_RECORD');
    return {
      ...base,
      clockOut: null,
      clockOutLocal: null,
      durationSeconds: 0,
      durationDisplay: formatDuration(0),
      open: true,
      valid: false,
      statuses,
    };
  }

  const seconds = diffSeconds(raw.clockIn, raw.clockOut);
  if (seconds < 0) {
    // Genuine bad data — excluded from worked totals, never silently summed.
    statuses.unshift('INVALID_DURATION', 'CLOCK_OUT_BEFORE_CLOCK_IN');
    return {
      ...base,
      clockOut: raw.clockOut.toISOString(),
      clockOutLocal: cyprusTime(raw.clockOut),
      durationSeconds: 0,
      durationDisplay: formatDuration(0),
      open: false,
      valid: false,
      statuses,
    };
  }

  if (cyprusDate(raw.clockOut) !== cyprusDate(raw.clockIn)) {
    statuses.push('OVERNIGHT_SHIFT');
  }

  return {
    ...base,
    clockOut: raw.clockOut.toISOString(),
    clockOutLocal: cyprusTime(raw.clockOut),
    durationSeconds: seconds,
    durationDisplay: formatDuration(seconds),
    open: false,
    valid: true,
    statuses,
  };
}

/**
 * Aggregate all raw sessions belonging to ONE employee on ONE Cyprus date.
 * Gross = sum of valid completed durations; the 45-minute break is applied
 * once to the day (never per session).
 */
export function aggregateDay(rawSessions: RawSession[]): DayResult {
  const sessions = [...rawSessions]
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())
    .map(classifySession);

  let grossSeconds = 0;
  let completedCount = 0;
  let openCount = 0;
  const methods = new Set<string>();
  const dayStatuses = new Set<ExceptionCode>();

  for (const s of sessions) {
    if (s.methodIn) methods.add(s.methodIn);
    if (s.methodOut) methods.add(s.methodOut);
    for (const code of s.statuses) dayStatuses.add(code);
    if (s.open) {
      openCount += 1;
    } else if (s.valid) {
      grossSeconds += s.durationSeconds;
      completedCount += 1;
    }
  }

  if (completedCount > 1) dayStatuses.add('MULTIPLE_RECORDS');

  // Overlap: any valid completed session starting before the previous ended.
  const valid = sessions.filter((s) => s.valid);
  for (let i = 1; i < valid.length; i++) {
    if (
      new Date(valid[i].clockIn).getTime() <
      new Date(valid[i - 1].clockOut as string).getTime()
    ) {
      dayStatuses.add('OVERLAPPING_RECORDS');
      break;
    }
  }

  const breakSeconds = dailyBreakSeconds(grossSeconds);
  const netSeconds = dailyNetSeconds(grossSeconds);

  const firstClockIn = sessions.length ? sessions[0].clockInLocal : null;
  const lastWithOut = [...sessions].reverse().find((s) => s.clockOut !== null);

  return {
    grossSeconds,
    breakSeconds,
    netSeconds,
    completedCount,
    openCount,
    recordsCount: sessions.length,
    firstClockIn,
    finalClockOut: lastWithOut ? lastWithOut.clockOutLocal : null,
    hasOpenRecord: openCount > 0,
    methods: [...methods],
    statuses: [...dayStatuses],
    sessions,
  };
}

/** Monday-based week key for a YYYY-MM-DD string, e.g. "Week of 2026-07-13". */
export function weekKeyOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - weekday);
  return `Week of ${d.toISOString().slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// CSV safety
// ---------------------------------------------------------------------------

/** Escape a CSV field and neutralise spreadsheet formula-injection triggers. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`; // prevent Excel/Sheets from evaluating it as a formula
  }
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build one CSV line from cell values (all sanitised). */
export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
