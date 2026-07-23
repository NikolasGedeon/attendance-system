import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import {
  BREAK_POLICY_TEXT,
  DAILY_BREAK_SECONDS,
  REPORT_TZ,
  RawSession,
  aggregateDay,
  csvRow,
  cyprusDate,
  formatDuration,
  secondsToDecimalHours,
  secondsToExcelDuration,
  weekKeyOf,
} from './report-policy.util';

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  period?: string; // daily | weekly | monthly
  userId?: string;
  search?: string;
  locationId?: string;
  employeeType?: string;
  position?: string;
  department?: string;
}

export interface ReportUserInfo {
  id: string;
  fullName: string;
  email: string | null;
  employeeCode: string | null;
  employeeType: string;
  position: string | null;
  department: string | null;
  location: string | null;
}

/** Amounts carried at day / period / total / grand levels (integer seconds + BC decimals). */
export interface Amounts {
  grossSeconds: number;
  breakSeconds: number;
  netSeconds: number;
  daysWorked: number;
  grossHours: number; // backward-compat decimal
  breakHours: number; // backward-compat decimal
  netHours: number; // backward-compat decimal
  grossDisplay: string; // HH:mm
  breakDisplay: string; // HH:mm
  netDisplay: string; // HH:mm
}

@Injectable()
export class AttendanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Advanced attendance report
  // -------------------------------------------------------------------

  async getAdvancedReport(filters: ReportFilters) {
    const range = this.parseRange(filters);
    const userWhere = this.buildUserWhere(filters);

    const records = await this.prisma.attendance.findMany({
      where: {
        clockIn: { gte: range.from, lt: range.toExclusive },
        user: userWhere,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            employeeCode: true,
            employeeType: true,
            department: true,
            position: { select: { name: true } },
            location: { select: { name: true } },
          },
        },
      },
      orderBy: { clockIn: 'asc' },
    });

    // Group: userId -> Cyprus dateStr -> raw records
    const byUser = new Map<
      string,
      { info: ReportUserInfo; days: Map<string, typeof records> }
    >();

    for (const record of records) {
      let entry = byUser.get(record.userId);
      if (!entry) {
        entry = {
          info: {
            id: record.user.id,
            fullName: record.user.fullName,
            email: record.user.email,
            employeeCode: record.user.employeeCode,
            employeeType: record.user.employeeType,
            position: record.user.position?.name ?? null,
            department: record.user.department,
            location: record.user.location?.name ?? null,
          },
          days: new Map(),
        };
        byUser.set(record.userId, entry);
      }
      const dateStr = cyprusDate(record.clockIn);
      const day = entry.days.get(dateStr) ?? [];
      day.push(record);
      entry.days.set(dateStr, day);
    }

    const users: any[] = [];
    const grand = this.zeroAmounts();
    const exceptionCounts = this.zeroExceptionCounts();

    for (const entry of byUser.values()) {
      const days: any[] = [];
      const weekTotals = new Map<string, Amounts & { key: string }>();
      const monthTotals = new Map<string, Amounts & { key: string }>();
      const userTotal = this.zeroAmounts();

      const sortedDates = [...entry.days.keys()].sort();
      for (const date of sortedDates) {
        const rawSessions: RawSession[] = entry.days.get(date)!.map((r) => ({
          id: r.id,
          clockIn: r.clockIn,
          clockOut: r.clockOut,
          methodIn: r.methodIn,
          methodOut: r.methodOut,
          latitude: r.latitude,
          longitude: r.longitude,
          isEdited: r.isEdited,
        }));

        const agg = aggregateDay(rawSessions);
        for (const code of agg.statuses) exceptionCounts[code] += 1;

        days.push({
          date,
          // --- backward-compat keys (still read by current Flutter) ---
          clockIn: agg.firstClockIn,
          clockOut: agg.finalClockOut,
          recordsCount: agg.recordsCount,
          hasOpenRecord: agg.hasOpenRecord,
          grossHours: secondsToDecimalHours(agg.grossSeconds),
          breakHours: secondsToDecimalHours(agg.breakSeconds),
          netHours: secondsToDecimalHours(agg.netSeconds),
          locations: entry.info.location ? [entry.info.location] : [],
          // --- new integer-second + display + drill-down fields ---
          firstClockIn: agg.firstClockIn,
          finalClockOut: agg.finalClockOut,
          completedCount: agg.completedCount,
          openCount: agg.openCount,
          grossSeconds: agg.grossSeconds,
          breakSeconds: agg.breakSeconds,
          netSeconds: agg.netSeconds,
          grossDisplay: formatDuration(agg.grossSeconds),
          breakDisplay: formatDuration(agg.breakSeconds),
          netDisplay: formatDuration(agg.netSeconds),
          methods: agg.methods,
          statuses: agg.statuses,
          sessions: agg.sessions,
        });

        this.addToPeriod(weekTotals, weekKeyOf(date), agg);
        this.addToPeriod(monthTotals, date.slice(0, 7), agg);
        this.accumulate(userTotal, agg);
      }

      users.push({
        user: entry.info,
        days,
        weeks: [...weekTotals.values()],
        months: [...monthTotals.values()],
        totals: userTotal,
      });

      this.accumulateAmounts(grand, userTotal);
    }

    users.sort((a, b) => a.user.fullName.localeCompare(b.user.fullName));

    return {
      dateFrom: range.fromStr,
      dateTo: range.toStr,
      period: this.parsePeriod(filters.period),
      timezone: REPORT_TZ,
      breakPolicy: BREAK_POLICY_TEXT,
      breakSecondsPerDay: DAILY_BREAK_SECONDS,
      usersCount: users.length,
      grandTotal: grand,
      exceptionCounts,
      users,
    };
  }

  // -------------------------------------------------------------------
  // Absence report (grouping unified on Europe/Nicosia)
  // -------------------------------------------------------------------

  async getAbsenceReport(filters: ReportFilters) {
    const range = this.parseRange(filters);
    const userWhere = this.buildUserWhere(filters);

    const users = await this.prisma.user.findMany({
      where: { ...userWhere, isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        employeeCode: true,
        employeeType: true,
        department: true,
        position: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    const records = await this.prisma.attendance.findMany({
      where: {
        clockIn: { gte: range.from, lt: range.toExclusive },
        userId: { in: users.map((u) => u.id) },
      },
      select: { userId: true, clockIn: true },
    });

    const present = new Set(
      records.map((r) => `${r.userId}|${cyprusDate(r.clockIn)}`),
    );

    const workingDays = this.workingDaysInRange(range.fromStr, range.toStr);

    const rows: Array<{
      date: string;
      userId: string;
      fullName: string;
      email: string | null;
      employeeCode: string | null;
      employeeType: string;
      position: string | null;
      department: string | null;
      location: string | null;
      status: 'ABSENT';
    }> = [];

    for (const date of workingDays) {
      for (const user of users) {
        if (!present.has(`${user.id}|${date}`)) {
          rows.push({
            date,
            userId: user.id,
            fullName: user.fullName,
            email: user.email,
            employeeCode: user.employeeCode,
            employeeType: user.employeeType,
            position: user.position?.name ?? null,
            department: user.department,
            location: user.location?.name ?? null,
            status: 'ABSENT',
          });
        }
      }
    }

    return {
      dateFrom: range.fromStr,
      dateTo: range.toStr,
      timezone: REPORT_TZ,
      workingDaysPolicy: 'Monday-Friday, no holiday calendar (Phase 1)',
      totalWorkingDays: workingDays.length,
      usersCount: users.length,
      absenceCount: rows.length,
      rows,
    };
  }

  // -------------------------------------------------------------------
  // Amount helpers (integer seconds are the source of truth)
  // -------------------------------------------------------------------

  private zeroAmounts(): Amounts {
    return {
      grossSeconds: 0,
      breakSeconds: 0,
      netSeconds: 0,
      daysWorked: 0,
      grossHours: 0,
      breakHours: 0,
      netHours: 0,
      grossDisplay: '00:00',
      breakDisplay: '00:00',
      netDisplay: '00:00',
    };
  }

  private zeroExceptionCounts(): Record<string, number> {
    return {
      OPEN_RECORD: 0,
      INVALID_DURATION: 0,
      CLOCK_OUT_BEFORE_CLOCK_IN: 0,
      OVERNIGHT_SHIFT: 0,
      OVERLAPPING_RECORDS: 0,
      MULTIPLE_RECORDS: 0,
      MANUALLY_ADJUSTED: 0,
    };
  }

  private refreshDerived(a: Amounts) {
    a.grossHours = secondsToDecimalHours(a.grossSeconds);
    a.breakHours = secondsToDecimalHours(a.breakSeconds);
    a.netHours = secondsToDecimalHours(a.netSeconds);
    a.grossDisplay = formatDuration(a.grossSeconds);
    a.breakDisplay = formatDuration(a.breakSeconds);
    a.netDisplay = formatDuration(a.netSeconds);
  }

  /** Add one aggregated day to a running Amounts total. */
  private accumulate(
    total: Amounts,
    day: { grossSeconds: number; breakSeconds: number; netSeconds: number },
  ) {
    total.grossSeconds += day.grossSeconds;
    total.breakSeconds += day.breakSeconds;
    total.netSeconds += day.netSeconds;
    total.daysWorked += 1;
    this.refreshDerived(total);
  }

  /** Merge one Amounts into another (user -> grand), summing days. */
  private accumulateAmounts(total: Amounts, part: Amounts) {
    total.grossSeconds += part.grossSeconds;
    total.breakSeconds += part.breakSeconds;
    total.netSeconds += part.netSeconds;
    total.daysWorked += part.daysWorked;
    this.refreshDerived(total);
  }

  private addToPeriod(
    map: Map<string, Amounts & { key: string }>,
    key: string,
    day: { grossSeconds: number; breakSeconds: number; netSeconds: number },
  ) {
    const entry =
      (map.get(key) as Amounts & { key: string }) ??
      ({ key, ...this.zeroAmounts() } as Amounts & { key: string });
    this.accumulate(entry, day);
    map.set(key, entry);
  }

  // -------------------------------------------------------------------
  // Excel workbook — Advanced report (professional, numeric durations)
  // -------------------------------------------------------------------

  private static readonly HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  private static readonly TOTAL_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEDF0F7' },
  };
  private static readonly GRAND_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD6DCE5' },
  };
  private static readonly CELL_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  };
  private static readonly DURATION_FMT = '[h]:mm';

  async buildAdvancedWorkbook(filters: ReportFilters): Promise<ExcelJS.Workbook> {
    const report = await this.getAdvancedReport(filters);
    const generatedAt = `${cyprusDate(new Date())} ${this.nowTime()}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attendance System';
    wb.created = new Date();

    this.buildDashboardSheet(wb, report, filters, generatedAt);
    this.buildAttendanceDetailSheet(wb, report);
    this.buildEmployeeSummarySheet(wb, report);
    this.buildDailySummarySheet(wb, report);
    this.buildExceptionsSheet(wb, report);
    this.buildAppliedFiltersSheet(wb, report, filters, generatedAt);

    return wb;
  }

  async buildAbsenceWorkbook(filters: ReportFilters): Promise<ExcelJS.Workbook> {
    const report = await this.getAbsenceReport(filters);
    const generatedAt = `${cyprusDate(new Date())} ${this.nowTime()}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attendance System';
    wb.created = new Date();

    const header = [
      'Date',
      'Employee Name',
      'Email',
      'Employee Code',
      'Employee Type',
      'Position',
      'Department',
      'Location',
      'Status',
    ];

    const ws = wb.addWorksheet('Absence Report', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    this.addTitle(
      ws,
      header.length,
      'Absence Report',
      `Date range: ${report.dateFrom} -> ${report.dateTo}   ·   ` +
        `Generated: ${generatedAt} (${REPORT_TZ})`,
    );

    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: header.length },
    };

    for (const r of report.rows) {
      const row = ws.addRow([
        r.date,
        r.fullName,
        r.email ?? '',
        r.employeeCode ?? '',
        r.employeeType,
        r.position ?? '',
        r.department ?? '',
        r.location ?? '',
        r.status,
      ]);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = AttendanceReportsService.CELL_BORDER;
      });
      const statusCell = row.getCell(9);
      statusCell.font = { bold: true, color: { argb: 'FF9C0006' } };
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFC7CE' },
      };
    }

    this.autoWidth(ws, header);

    this.addSummarySheet(wb, [
      ['Report', 'Absence Report'],
      ['Date From', report.dateFrom],
      ['Date To', report.dateTo],
      ['Working Days', report.totalWorkingDays],
      ['Users Checked', report.usersCount],
      ['Absent Employee-Days', report.absenceCount],
      ['Applied Filters', this.describeFilters(filters)],
      ['Working Days Policy', report.workingDaysPolicy],
      ['Timezone', REPORT_TZ],
      ['Generated At', generatedAt],
    ]);

    return wb;
  }

  // ----- Advanced workbook sheets -----

  private buildDashboardSheet(
    wb: ExcelJS.Workbook,
    report: any,
    filters: ReportFilters,
    generatedAt: string,
  ) {
    const ws = wb.addWorksheet('Dashboard');
    ws.mergeCells(1, 1, 1, 4);
    const title = ws.getCell(1, 1);
    title.value = 'Advanced Attendance Report';
    title.font = { size: 16, bold: true, color: { argb: 'FF1F3864' } };
    ws.mergeCells(2, 1, 2, 4);
    ws.getCell(2, 1).value =
      `Date range: ${report.dateFrom} -> ${report.dateTo}   ·   Period: ${report.period}` +
      `   ·   Generated: ${generatedAt} (${REPORT_TZ})`;
    ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF595959' } };
    ws.addRow([]);

    ws.addRow(['Applied Filters', this.describeFilters(filters)]);
    ws.addRow([]);

    const kpiHeader = ws.addRow(['KPI', 'Value']);
    this.styleHeaderRow(kpiHeader);

    const g = report.grandTotal;
    const ex = report.exceptionCounts;
    const kpis: Array<[string, number | string, boolean?]> = [
      ['Employees Included', report.usersCount],
      ['Days With Attendance', g.daysWorked],
      ['Gross Time', g.grossSeconds, true],
      ['Scheduled Break Time', g.breakSeconds, true],
      ['Net Worked Time', g.netSeconds, true],
      ['Open Records', ex.OPEN_RECORD],
      ['Invalid Records', ex.INVALID_DURATION],
      ['Manually Adjusted Records', ex.MANUALLY_ADJUSTED],
      ['Overnight Shifts', ex.OVERNIGHT_SHIFT],
      ['Overlapping Records', ex.OVERLAPPING_RECORDS],
    ];
    for (const [label, value, isDuration] of kpis) {
      const row = ws.addRow([label, '']);
      row.getCell(1).font = { bold: true };
      const valueCell = row.getCell(2);
      if (isDuration) {
        valueCell.value = secondsToExcelDuration(value as number);
        valueCell.numFmt = AttendanceReportsService.DURATION_FMT;
      } else {
        valueCell.value = value as number;
      }
      row.eachCell({ includeEmpty: true }, (c) => {
        c.border = AttendanceReportsService.CELL_BORDER;
      });
    }

    ws.addRow([]);
    ws.addRow(['Break Policy', BREAK_POLICY_TEXT]);
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 52;
  }

  private buildAttendanceDetailSheet(wb: ExcelJS.Workbook, report: any) {
    const header = [
      'Employee Name',
      'Employee Code',
      'Employee Type',
      'Department',
      'Position',
      'Location',
      'Cyprus Date',
      'Clock In',
      'Clock Out',
      'Gross Duration',
      'Method In',
      'Method Out',
      'Clock-In Geolocation',
      'Clock-Out Geolocation',
      'Geofence Result',
      'Status',
      'Adjustment Status',
    ];
    const durationCols = [10];
    const ws = wb.addWorksheet('Attendance Detail', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };

    for (const u of report.users) {
      for (const day of u.days) {
        for (const s of day.sessions) {
          const geoIn =
            s.latitude != null && s.longitude != null
              ? `${s.latitude}, ${s.longitude}`
              : '-';
          const row = ws.addRow([
            u.user.fullName,
            u.user.employeeCode ?? '',
            u.user.employeeType,
            u.user.department ?? '',
            u.user.position ?? '',
            u.user.location ?? '',
            day.date,
            s.clockInLocal ?? '',
            s.clockOutLocal ?? '',
            secondsToExcelDuration(s.durationSeconds),
            s.methodIn ?? '',
            s.methodOut ?? '',
            geoIn,
            '-', // clock-out geolocation (Stage 2)
            '-', // geofence result (Stage 2)
            s.statuses.join(', ') || (s.open ? 'OPEN RECORD' : 'OK'),
            s.isEdited ? 'MANUALLY ADJUSTED' : '',
          ]);
          this.borderRow(row, durationCols);
        }
      }
    }
    this.autoWidth(ws, header);
  }

  private buildEmployeeSummarySheet(wb: ExcelJS.Workbook, report: any) {
    const header = [
      'Employee Name',
      'Employee Code',
      'Employee Type',
      'Department',
      'Position',
      'Location',
      'Days With Attendance',
      'Gross Duration',
      'Break Duration',
      'Net Duration',
      'Open Records',
      'Invalid Records',
      'Adjusted Records',
    ];
    const durationCols = [8, 9, 10];
    const ws = wb.addWorksheet('Employee Summary', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };

    for (const u of report.users) {
      let open = 0;
      let invalid = 0;
      let adjusted = 0;
      for (const day of u.days) {
        open += day.openCount;
        if (day.statuses.includes('INVALID_DURATION')) invalid += 1;
        if (day.statuses.includes('MANUALLY_ADJUSTED')) adjusted += 1;
      }
      const row = ws.addRow([
        u.user.fullName,
        u.user.employeeCode ?? '',
        u.user.employeeType,
        u.user.department ?? '',
        u.user.position ?? '',
        u.user.location ?? '',
        u.totals.daysWorked,
        secondsToExcelDuration(u.totals.grossSeconds),
        secondsToExcelDuration(u.totals.breakSeconds),
        secondsToExcelDuration(u.totals.netSeconds),
        open,
        invalid,
        adjusted,
      ]);
      this.borderRow(row, durationCols);
    }

    // GRAND TOTAL — only meaningful columns populated (fixes stray values).
    ws.addRow([]);
    const g = report.grandTotal;
    const grand = ws.addRow([
      'GRAND TOTAL',
      '',
      '',
      '',
      '',
      '',
      g.daysWorked,
      secondsToExcelDuration(g.grossSeconds),
      secondsToExcelDuration(g.breakSeconds),
      secondsToExcelDuration(g.netSeconds),
      '',
      '',
      '',
    ]);
    grand.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { bold: true };
      cell.fill = AttendanceReportsService.GRAND_FILL;
      cell.border = AttendanceReportsService.CELL_BORDER;
      if (durationCols.includes(col)) {
        cell.numFmt = AttendanceReportsService.DURATION_FMT;
      }
    });
    this.autoWidth(ws, header);
  }

  private buildDailySummarySheet(wb: ExcelJS.Workbook, report: any) {
    const header = [
      'Employee Name',
      'Employee Code',
      'Cyprus Date',
      'First Clock In',
      'Final Clock Out',
      'Sessions',
      'Gross Duration',
      'Break Duration',
      'Net Duration',
      'Status',
    ];
    const durationCols = [7, 8, 9];
    const ws = wb.addWorksheet('Daily Summary', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };

    for (const u of report.users) {
      for (const day of u.days) {
        const status = day.hasOpenRecord
          ? 'OPEN RECORD'
          : day.statuses.length
            ? day.statuses.join(', ')
            : '';
        const row = ws.addRow([
          u.user.fullName,
          u.user.employeeCode ?? '',
          day.date,
          day.firstClockIn ?? '',
          day.finalClockOut ?? '',
          day.completedCount,
          secondsToExcelDuration(day.grossSeconds),
          secondsToExcelDuration(day.breakSeconds),
          secondsToExcelDuration(day.netSeconds),
          status,
        ]);
        this.borderRow(row, durationCols);
      }

      // USER TOTAL — only meaningful columns populated.
      const t = ws.addRow([
        `${u.user.fullName} — USER TOTAL`,
        '',
        '',
        '',
        '',
        u.totals.daysWorked,
        secondsToExcelDuration(u.totals.grossSeconds),
        secondsToExcelDuration(u.totals.breakSeconds),
        secondsToExcelDuration(u.totals.netSeconds),
        '',
      ]);
      t.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { bold: true };
        cell.fill = AttendanceReportsService.TOTAL_FILL;
        cell.border = AttendanceReportsService.CELL_BORDER;
        if (durationCols.includes(col)) {
          cell.numFmt = AttendanceReportsService.DURATION_FMT;
        }
      });
    }
    this.autoWidth(ws, header);
  }

  private buildExceptionsSheet(wb: ExcelJS.Workbook, report: any) {
    const header = [
      'Employee Name',
      'Employee Code',
      'Cyprus Date',
      'Attendance ID',
      'Exception Type',
      'Detail',
    ];
    const ws = wb.addWorksheet('Exceptions', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };

    for (const u of report.users) {
      for (const day of u.days) {
        for (const s of day.sessions) {
          for (const code of s.statuses) {
            const row = ws.addRow([
              u.user.fullName,
              u.user.employeeCode ?? '',
              day.date,
              s.id,
              code,
              `${s.clockInLocal ?? '-'} -> ${s.clockOutLocal ?? '-'}`,
            ]);
            row.eachCell({ includeEmpty: true }, (c) => {
              c.border = AttendanceReportsService.CELL_BORDER;
            });
          }
        }
      }
    }
    this.autoWidth(ws, header);
  }

  private buildAppliedFiltersSheet(
    wb: ExcelJS.Workbook,
    report: any,
    filters: ReportFilters,
    generatedAt: string,
  ) {
    this.addSummarySheet(
      wb,
      [
        ['Report', 'Advanced Attendance Report'],
        ['Date From', report.dateFrom],
        ['Date To', report.dateTo],
        ['Period', report.period],
        ['Applied Filters', this.describeFilters(filters)],
        ['Total Employees', report.usersCount],
        ['Total Days Worked', report.grandTotal.daysWorked],
        ['Total Gross', report.grandTotal.grossDisplay],
        ['Total Break', report.grandTotal.breakDisplay],
        ['Total Net', report.grandTotal.netDisplay],
        ['Break Policy', BREAK_POLICY_TEXT],
        ['Timezone', REPORT_TZ],
        ['Generated At', generatedAt],
      ],
      'Applied Filters',
    );
  }

  // -------------------------------------------------------------------
  // CSV exports (human-readable durations, formula-injection safe)
  // -------------------------------------------------------------------

  async buildAdvancedCsv(filters: ReportFilters): Promise<string> {
    const report = await this.getAdvancedReport(filters);
    const lines: string[] = [];
    lines.push(
      csvRow([
        'Employee Name',
        'Employee Code',
        'Employee Type',
        'Department',
        'Position',
        'Location',
        'Cyprus Date',
        'Clock In',
        'Clock Out',
        'Gross Duration',
        'Gross Decimal Hours',
        'Method In',
        'Method Out',
        'Clock-In Geolocation',
        'Status',
      ]),
    );
    for (const u of report.users) {
      for (const day of u.days) {
        for (const s of day.sessions) {
          lines.push(
            csvRow([
              u.user.fullName,
              u.user.employeeCode ?? '',
              u.user.employeeType,
              u.user.department ?? '',
              u.user.position ?? '',
              u.user.location ?? '',
              day.date,
              s.clockInLocal ?? '',
              s.clockOutLocal ?? '',
              formatDuration(s.durationSeconds),
              secondsToDecimalHours(s.durationSeconds),
              s.methodIn ?? '',
              s.methodOut ?? '',
              s.latitude != null && s.longitude != null
                ? `${s.latitude} ${s.longitude}`
                : '',
              s.statuses.join(' | ') || (s.open ? 'OPEN RECORD' : 'OK'),
            ]),
          );
        }
      }
    }
    // Daily net summary block (net time is a per-day figure, not per session).
    lines.push('');
    lines.push(
      csvRow([
        'DAILY SUMMARY',
        'Employee Code',
        'Cyprus Date',
        'Sessions',
        'Gross Duration',
        'Break Duration',
        'Net Duration',
        'Net Decimal Hours',
        'Status',
      ]),
    );
    for (const u of report.users) {
      for (const day of u.days) {
        lines.push(
          csvRow([
            u.user.fullName,
            u.user.employeeCode ?? '',
            day.date,
            day.completedCount,
            day.grossDisplay,
            day.breakDisplay,
            day.netDisplay,
            secondsToDecimalHours(day.netSeconds),
            day.hasOpenRecord ? 'OPEN RECORD' : day.statuses.join(' | '),
          ]),
        );
      }
    }
    return lines.join('\r\n');
  }

  async buildAbsenceCsv(filters: ReportFilters): Promise<string> {
    const report = await this.getAbsenceReport(filters);
    const lines: string[] = [];
    lines.push(
      csvRow([
        'Date',
        'Employee Name',
        'Email',
        'Employee Code',
        'Employee Type',
        'Position',
        'Department',
        'Location',
        'Status',
      ]),
    );
    for (const r of report.rows) {
      lines.push(
        csvRow([
          r.date,
          r.fullName,
          r.email ?? '',
          r.employeeCode ?? '',
          r.employeeType,
          r.position ?? '',
          r.department ?? '',
          r.location ?? '',
          r.status,
        ]),
      );
    }
    return lines.join('\r\n');
  }

  // ----- ExcelJS style helpers -----

  private nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: REPORT_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  private borderRow(row: ExcelJS.Row, durationCols: number[]) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = AttendanceReportsService.CELL_BORDER;
      if (durationCols.includes(col) && typeof cell.value === 'number') {
        cell.numFmt = AttendanceReportsService.DURATION_FMT;
      }
    });
  }

  private addTitle(
    ws: ExcelJS.Worksheet,
    columns: number,
    title: string,
    subtitle: string,
  ) {
    ws.mergeCells(1, 1, 1, columns);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FF1F3864' } };

    ws.mergeCells(2, 1, 2, columns);
    const subtitleCell = ws.getCell(2, 1);
    subtitleCell.value = subtitle;
    subtitleCell.font = { size: 10, italic: true, color: { argb: 'FF595959' } };

    ws.addRow([]); // row 3 spacer
  }

  private styleHeaderRow(row: ExcelJS.Row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = AttendanceReportsService.HEADER_FILL;
      cell.alignment = { vertical: 'middle' };
      cell.border = AttendanceReportsService.CELL_BORDER;
    });
  }

  private autoWidth(ws: ExcelJS.Worksheet, header: string[]) {
    ws.columns.forEach((column, i) => {
      let max = header[i]?.length ?? 10;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = len;
      });
      column.width = Math.min(42, Math.max(11, max + 3));
    });
  }

  private addSummarySheet(
    wb: ExcelJS.Workbook,
    rows: Array<[string, string | number]>,
    sheetName = 'Summary',
  ) {
    const ws = wb.addWorksheet(sheetName);
    ws.mergeCells(1, 1, 1, 2);
    const title = ws.getCell(1, 1);
    title.value = sheetName;
    title.font = { size: 14, bold: true, color: { argb: 'FF1F3864' } };
    ws.addRow([]);

    for (const [key, value] of rows) {
      const row = ws.addRow([key, value]);
      row.getCell(1).font = { bold: true };
      row.getCell(1).border = AttendanceReportsService.CELL_BORDER;
      row.getCell(2).border = AttendanceReportsService.CELL_BORDER;
    }
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 70;
  }

  private describeFilters(filters: ReportFilters): string {
    const parts: string[] = [];
    if (filters.search?.trim()) parts.push(`search="${filters.search.trim()}"`);
    if (filters.userId) parts.push(`userId=${filters.userId}`);
    if (filters.locationId) parts.push(`locationId=${filters.locationId}`);
    if (filters.employeeType) parts.push(`type=${filters.employeeType}`);
    if (filters.position?.trim()) parts.push(`position=${filters.position.trim()}`);
    if (filters.department?.trim()) {
      parts.push(`department=${filters.department.trim()}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'None';
  }

  // -------------------------------------------------------------------
  // Filter / date helpers
  // -------------------------------------------------------------------

  private buildUserWhere(filters: ReportFilters): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (filters.userId) {
      where.id = filters.userId;
    }
    if (filters.locationId) {
      where.locationId = filters.locationId;
    }
    if (filters.employeeType) {
      const type = filters.employeeType.trim().toUpperCase();
      if (type !== 'INTERNAL' && type !== 'EXTERNAL') {
        throw new BadRequestException(
          'employeeType must be INTERNAL or EXTERNAL',
        );
      }
      where.employeeType = type as Prisma.UserWhereInput['employeeType'];
    }
    if (filters.position?.trim()) {
      where.position = {
        is: { name: { equals: filters.position.trim(), mode: 'insensitive' } },
      };
    }
    if (filters.department?.trim()) {
      where.department = {
        equals: filters.department.trim(),
        mode: 'insensitive',
      };
    }
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { employeeCode: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
        { position: { is: { name: { contains: q, mode: 'insensitive' } } } },
        { location: { is: { name: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  private parsePeriod(period?: string): 'daily' | 'weekly' | 'monthly' {
    const p = (period || 'daily').toLowerCase();
    if (p !== 'daily' && p !== 'weekly' && p !== 'monthly') {
      throw new BadRequestException('period must be daily, weekly or monthly');
    }
    return p;
  }

  private parseRange(filters: ReportFilters) {
    const today = cyprusDate(new Date());
    const defaultFrom = `${today.slice(0, 7)}-01`;

    const fromStr = filters.dateFrom?.trim() || defaultFrom;
    const toStr = filters.dateTo?.trim() || today;

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(toStr)
    ) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }
    if (fromStr > toStr) {
      throw new BadRequestException('dateFrom must be before dateTo');
    }

    // Widen the UTC query window so records near local midnight are captured,
    // then rely on cyprusDate() grouping to assign each to the correct day.
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    from.setUTCHours(from.getUTCHours() - 14);
    const toExclusive = new Date(`${toStr}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    toExclusive.setUTCHours(toExclusive.getUTCHours() + 14);

    return { from, toExclusive, fromStr, toStr };
  }

  /** All Monday-Friday dates between from and to (inclusive). */
  private workingDaysInRange(fromStr: string, toStr: string): string[] {
    const days: string[] = [];
    const cursor = new Date(`${fromStr}T00:00:00.000Z`);
    const end = new Date(`${toStr}T00:00:00.000Z`);

    while (cursor <= end) {
      const weekday = cursor.getUTCDay(); // 0 Sun ... 6 Sat
      if (weekday >= 1 && weekday <= 5) {
        days.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }
}
