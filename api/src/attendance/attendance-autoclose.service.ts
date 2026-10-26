import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { $Enums } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_TZ } from './report-policy.util';

/**
 * Closes shifts the employee never clocked out of.
 *
 * Two different rules, because two different kinds of employee:
 *
 *  - INTERNAL staff work inside a calendar day. Their forgotten shift is
 *    closed at MIDNIGHT OF THE DAY IT STARTED (Europe/Nicosia) — not at the
 *    midnight the job happens to run. A shift left open for three weeks is
 *    therefore closed at the end of its own first day, which is the only
 *    defensible figure; closing it "now" would bank three weeks of pay.
 *
 *  - EXTERNAL staff (Security) work through the night, so a wall-clock
 *    cut-off would slice every genuine shift in half. They get a DURATION
 *    cap instead: a shift open longer than AUTO_CLOSE_EXTERNAL_MAX_HOURS is
 *    closed at clockIn + that many hours.
 *
 * Every row this job writes is marked `methodOut = AUTO_CLOSE`, so reports
 * can always separate a real clock-out from one the system supplied. The
 * hours are NOT silently trusted — see the AUTO_CLOSED exception code in
 * report-policy.util.ts.
 *
 * The job only ever fills a NULL clockOut. It never edits a closed record.
 */
/**
 * `AUTO_CLOSE` is added to the AttendanceMethod enum by migration
 * 20261026000000_add_auto_close_method. A Prisma client generated BEFORE that
 * migration does not know the member yet, so the literal is widened here.
 * The deploy regenerates the client via the `postinstall` script, after which
 * this cast is a no-op. The value is still checked at runtime by Postgres:
 * if the migration has not been applied, the UPDATE fails loudly rather than
 * writing a bad row.
 */
const AUTO_CLOSE_METHOD = 'AUTO_CLOSE' as unknown as $Enums.AttendanceMethod;

@Injectable()
export class AttendanceAutoCloseService {
  private readonly logger = new Logger(AttendanceAutoCloseService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Default cap for EXTERNAL shifts. Real shifts run 8-12h; 16 leaves room. */
  static readonly DEFAULT_EXTERNAL_MAX_HOURS = 16;

  private get externalMaxHours(): number {
    const raw = Number(process.env.AUTO_CLOSE_EXTERNAL_MAX_HOURS);
    return Number.isFinite(raw) && raw > 0
      ? raw
      : AttendanceAutoCloseService.DEFAULT_EXTERNAL_MAX_HOURS;
  }

  private get enabled(): boolean {
    return process.env.AUTO_CLOSE_ENABLED !== 'false';
  }

  @Cron('0 0 * * *', {
    name: 'attendance-auto-close',
    timeZone: REPORT_TZ,
  })
  async handleNightlyAutoClose(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('Auto-close disabled via AUTO_CLOSE_ENABLED=false');
      return;
    }
    const result = await this.run(new Date());
    this.logger.log(
      `Auto-close: ${result.internalClosed} internal, ` +
        `${result.externalClosed} external, ${result.skipped} skipped`,
    );
  }

  /**
   * `now` is injectable so the behaviour is testable and so an admin can
   * replay the job over a backlog without waiting for midnight.
   */
  async run(now: Date): Promise<AutoCloseResult> {
    const open = await this.prisma.attendance.findMany({
      where: { clockOut: null },
      select: {
        id: true,
        clockIn: true,
        userId: true,
        user: { select: { employeeType: true } },
      },
    });

    let internalClosed = 0;
    let externalClosed = 0;
    let skipped = 0;

    for (const record of open) {
      const clockOut =
        record.user?.employeeType === 'EXTERNAL'
          ? this.externalCutoff(record.clockIn)
          : cyprusEndOfDay(record.clockIn);

      // Never write a clockOut at or before clockIn, and never write one in
      // the future: a shift still legitimately running is left alone.
      if (clockOut.getTime() <= record.clockIn.getTime()) {
        skipped += 1;
        continue;
      }
      if (clockOut.getTime() > now.getTime()) {
        skipped += 1;
        continue;
      }

      // Guarded update: if the employee clocked out in the meantime, the
      // `clockOut: null` condition makes this a no-op instead of an overwrite.
      const updated = await this.prisma.attendance.updateMany({
        where: { id: record.id, clockOut: null },
        data: { clockOut, methodOut: AUTO_CLOSE_METHOD },
      });
      if (updated.count === 0) {
        skipped += 1;
        continue;
      }
      if (record.user?.employeeType === 'EXTERNAL') externalClosed += 1;
      else internalClosed += 1;
    }

    return { internalClosed, externalClosed, skipped, examined: open.length };
  }

  private externalCutoff(clockIn: Date): Date {
    return new Date(clockIn.getTime() + this.externalMaxHours * 3600_000);
  }
}

export interface AutoCloseResult {
  examined: number;
  internalClosed: number;
  externalClosed: number;
  skipped: number;
}

/** What the Cyprus wall clock reads at `at`, minus real UTC, in ms. */
function cyprusOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(at);
  // 'YYYY-MM-DD, HH:MM:SS'
  const iso = `${parts.replace(', ', 'T')}Z`;
  return Date.parse(iso) - at.getTime();
}

/**
 * The instant of the NEXT Cyprus midnight after `at` — i.e. the end of the
 * Cyprus day that `at` falls in. Two passes so the result stays correct when
 * the DST offset differs between the guess and the answer.
 */
export function cyprusEndOfDay(at: Date): Date {
  const local = new Date(at.getTime() + cyprusOffsetMs(at));
  const nextLocalMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  let utc = nextLocalMidnight - cyprusOffsetMs(at);
  utc = nextLocalMidnight - cyprusOffsetMs(new Date(utc));
  return new Date(utc);
}
