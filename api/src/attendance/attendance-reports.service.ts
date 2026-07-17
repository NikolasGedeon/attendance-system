import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

/** Timezone used for day grouping and time formatting in reports. */
const REPORT_TZ = 'Asia/Nicosia';

/** Hours deducted once per user per day as an unpaid break. */
const DAILY_BREAK_HOURS = 1;

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

export interface DayRow {
  date: string;
  clockIn: string | null; // HH:MM local, first record of the day
  clockOut: string | null; // HH:MM local, last record of the day
  recordsCount: number;
  hasOpenRecord: boolean;
  grossHours: number;
  breakHours: number;
  netHours: number;
  locations: string[];
}

export interface PeriodTotal {
  key: string; // "Week of 2026-07-06" or "2026-07"
  grossHours: number;
  breakHours: number;
  netHours: number;
  daysWorked: number;
}

export interface UserReport {
  user: ReportUserInfo;
  days: DayRow[];
  weeks: PeriodTotal[];
  months: PeriodTotal[];
  totals: {
    grossHours: number;
    breakHours: number;
    netHours: number;
    daysWorked: number;
  };
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

    // Group: userId -> dateStr -> raw records
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
      const dateStr = this.localDate(record.clockIn);
      const day = entry.days.get(dateStr) ?? [];
      day.push(record);
      entry.days.set(dateStr, day);
    }

    const users: UserReport[] = [];
    const grandTotal = { grossHours: 0, breakHours: 0, netHours: 0, daysWorked: 0 };

    for (const entry of byUser.values()) {
      const days: DayRow[] = [];
      const weekTotals = new Map<string, PeriodTotal>();
      const monthTotals = new Map<string, PeriodTotal>();
      const userTotal = {
        grossHours: 0,
        breakHours: 0,
        netHours: 0,
        daysWorked: 0,
      };

      const sortedDates = [...entry.days.keys()].sort();
      for (const date of sortedDates) {
        const dayRecords = entry.days.get(date)!;

        // Sum gross hours over all records of the day first,
        // then deduct the break once per day.
        let gross = 0;
        let hasOpen = false;
        const locations = new Set<string>();
        for (const r of dayRecords) {
          if (r.clockOut) {
            gross += (r.clockOut.getTime() - r.clockIn.getTime()) / 3_600_000;
          } else {
            hasOpen = true;
          }
          if (entry.info.location) locations.add(entry.info.location);
        }
        gross = this.round(gross);
        const breakHours = this.round(Math.min(DAILY_BREAK_HOURS, gross));
        const net = this.round(Math.max(0, gross - DAILY_BREAK_HOURS));

        const first = dayRecords[0];
        const lastWithOut = [...dayRecords]
          .reverse()
          .find((r) => r.clockOut !== null);

        days.push({
          date,
          clockIn: this.localTime(first.clockIn),
          clockOut: lastWithOut?.clockOut
            ? this.localTime(lastWithOut.clockOut)
            : null,
          recordsCount: dayRecords.length,
          hasOpenRecord: hasOpen,
          grossHours: gross,
          breakHours,
          netHours: net,
          locations: [...locations],
        });

        this.addToPeriod(weekTotals, this.weekKey(date), gross, breakHours, net);
        this.addToPeriod(monthTotals, date.slice(0, 7), gross, breakHours, net);

        userTotal.grossHours = this.round(userTotal.grossHours + gross);
        userTotal.breakHours = this.round(userTotal.breakHours + breakHours);
        userTotal.netHours = this.round(userTotal.netHours + net);
        userTotal.daysWorked += 1;
      }

      users.push({
        user: entry.info,
        days,
        weeks: [...weekTotals.values()],
        months: [...monthTotals.values()],
        totals: userTotal,
      });

      grandTotal.grossHours = this.round(
        grandTotal.grossHours + userTotal.grossHours,
      );
      grandTotal.breakHours = this.round(
        grandTotal.breakHours + userTotal.breakHours,
      );
      grandTotal.netHours = this.round(grandTotal.netHours + userTotal.netHours);
      grandTotal.daysWorked += userTotal.daysWorked;
    }

    users.sort((a, b) => a.user.fullName.localeCompare(b.user.fullName));

    return {
      dateFrom: range.fromStr,
      dateTo: range.toStr,
      period: this.parsePeriod(filters.period),
      timezone: REPORT_TZ,
      breakPolicy: `${DAILY_BREAK_HOURS}h deducted once per user per day`,
      usersCount: users.length,
      grandTotal,
      users,
    };
  }

  // -------------------------------------------------------------------
  // Absence report
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
      records.map((r) => `${r.userId}|${this.localDate(r.clockIn)}`),
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
  // Workbook builders (ExcelJS, styled for management/HR)
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

  async buildAdvancedWorkbook(
    filters: ReportFilters,
  ): Promise<ExcelJS.Workbook> {
    const report = await this.getAdvancedReport(filters);
    const period = report.period;
    const generatedAt = `${this.localDate(new Date())} ${this.localTime(new Date())}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attendance System';
    wb.created = new Date();

    const header = [
      'Employee Name',
      'Employee Code',
      'Employee Type',
      'Position',
      'Department',
      'Location',
      'Date',
      'Clock In',
      'Clock Out',
      'Gross Hours',
      'Break Hours',
      'Net Hours',
      'Status / Notes',
    ];
    const hoursCols = [10, 11, 12];

    const ws = wb.addWorksheet('Attendance Report', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    this.addTitle(
      ws,
      header.length,
      'Attendance Report',
      `Date range: ${report.dateFrom} → ${report.dateTo}   ·   ` +
        `Period: ${period}   ·   Generated: ${generatedAt} (${REPORT_TZ})`,
    );

    const headerRow = ws.addRow(header);
    this.styleHeaderRow(headerRow);
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4, column: header.length },
    };

    const addDataRow = (
      values: (string | number)[],
      opts: { fill?: ExcelJS.Fill; bold?: boolean } = {},
    ) => {
      const row = ws.addRow(values);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = AttendanceReportsService.CELL_BORDER;
        if (opts.fill) cell.fill = opts.fill;
        if (opts.bold) cell.font = { bold: true };
        if (hoursCols.includes(col) && typeof cell.value === 'number') {
          cell.numFmt = '0.00';
        }
      });
      return row;
    };

    for (const u of report.users) {
      const base = [
        u.user.fullName,
        u.user.employeeCode ?? '',
        u.user.employeeType,
        u.user.position ?? '',
        u.user.department ?? '',
        u.user.location ?? '',
      ];

      for (const day of u.days) {
        const row = addDataRow([
          ...base,
          day.date,
          day.clockIn ?? '',
          day.clockOut ?? '',
          day.grossHours,
          day.breakHours,
          day.netHours,
          day.hasOpenRecord
            ? 'OPEN RECORD'
            : day.recordsCount > 1
              ? `${day.recordsCount} records`
              : '',
        ]);
        if (day.hasOpenRecord) {
          row.getCell(13).font = { bold: true, color: { argb: 'FF9C0006' } };
        }
      }

      if (period === 'weekly' || period === 'monthly') {
        for (const w of u.weeks) {
          addDataRow(
            [
              ...base,
              `${w.key} — Total`,
              '',
              `${w.daysWorked} day(s)`,
              w.grossHours,
              w.breakHours,
              w.netHours,
              '',
            ],
            { fill: AttendanceReportsService.TOTAL_FILL, bold: true },
          );
        }
      }
      if (period === 'monthly') {
        for (const m of u.months) {
          addDataRow(
            [
              ...base,
              `Month ${m.key} — Total`,
              '',
              `${m.daysWorked} day(s)`,
              m.grossHours,
              m.breakHours,
              m.netHours,
              '',
            ],
            { fill: AttendanceReportsService.TOTAL_FILL, bold: true },
          );
        }
      }

      addDataRow(
        [
          ...base,
          'USER TOTAL',
          '',
          `${u.totals.daysWorked} day(s)`,
          u.totals.grossHours,
          u.totals.breakHours,
          u.totals.netHours,
          '',
        ],
        { fill: AttendanceReportsService.TOTAL_FILL, bold: true },
      );
    }

    ws.addRow([]);
    const grand = addDataRow(
      [
        'GRAND TOTAL',
        '',
        '',
        '',
        '',
        '',
        `${report.dateFrom} → ${report.dateTo}`,
        '',
        `${report.grandTotal.daysWorked} day(s)`,
        report.grandTotal.grossHours,
        report.grandTotal.breakHours,
        report.grandTotal.netHours,
        '',
      ],
      { fill: AttendanceReportsService.GRAND_FILL, bold: true },
    );
    grand.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        ...AttendanceReportsService.CELL_BORDER,
        top: { style: 'double', color: { argb: 'FF4472C4' } },
      };
    });

    this.autoWidth(ws, header);

    this.addSummarySheet(wb, [
      ['Report', 'Advanced Attendance Report'],
      ['Date From', report.dateFrom],
      ['Date To', report.dateTo],
      ['Period', period],
      ['Applied Filters', this.describeFilters(filters)],
      ['Total Users', report.usersCount],
      ['Total Days Worked', report.grandTotal.daysWorked],
      ['Total Gross Hours', report.grandTotal.grossHours],
      ['Total Break Hours', report.grandTotal.breakHours],
      ['Total Net Hours', report.grandTotal.netHours],
      ['Break Policy', report.breakPolicy],
      ['Timezone', REPORT_TZ],
      ['Generated At', generatedAt],
    ]);

    return wb;
  }

  async buildAbsenceWorkbook(
    filters: ReportFilters,
  ): Promise<ExcelJS.Workbook> {
    const report = await this.getAbsenceReport(filters);
    const generatedAt = `${this.localDate(new Date())} ${this.localTime(new Date())}`;

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
      `Date range: ${report.dateFrom} → ${report.dateTo}   ·   ` +
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
      ['Absence Count', report.absenceCount],
      ['Applied Filters', this.describeFilters(filters)],
      ['Working Days Policy', report.workingDaysPolicy],
      ['Timezone', REPORT_TZ],
      ['Generated At', generatedAt],
    ]);

    return wb;
  }

  // ----- ExcelJS style helpers -----

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
  ) {
    const ws = wb.addWorksheet('Summary');
    ws.mergeCells(1, 1, 1, 2);
    const title = ws.getCell(1, 1);
    title.value = 'Summary';
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
    const today = this.localDate(new Date());
    const defaultFrom = `${today.slice(0, 7)}-01`;

    const fromStr = filters.dateFrom?.trim() || defaultFrom;
    const toStr = filters.dateTo?.trim() || today;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      throw new BadRequestException('Dates must be in YYYY-MM-DD format');
    }
    if (fromStr > toStr) {
      throw new BadRequestException('dateFrom must be before dateTo');
    }

    // Interpret the local dates generously: start a bit before local
    // midnight and end a bit after, then rely on localDate() grouping.
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    from.setUTCHours(from.getUTCHours() - 14); // cover TZs ahead of UTC
    const toExclusive = new Date(`${toStr}T00:00:00.000Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    toExclusive.setUTCHours(toExclusive.getUTCHours() + 14);

    return { from, toExclusive, fromStr, toStr };
  }

  /** YYYY-MM-DD in the report timezone. */
  private localDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: REPORT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  /** HH:MM in the report timezone. */
  private localTime(date: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: REPORT_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  /** Monday-based week key for a YYYY-MM-DD date string. */
  private weekKey(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const weekday = (d.getUTCDay() + 6) % 7; // 0 = Monday
    d.setUTCDate(d.getUTCDate() - weekday);
    return `Week of ${d.toISOString().slice(0, 10)}`;
  }

  private addToPeriod(
    map: Map<string, PeriodTotal>,
    key: string,
    gross: number,
    breakHours: number,
    net: number,
  ) {
    const entry = map.get(key) ?? {
      key,
      grossHours: 0,
      breakHours: 0,
      netHours: 0,
      daysWorked: 0,
    };
    entry.grossHours = this.round(entry.grossHours + gross);
    entry.breakHours = this.round(entry.breakHours + breakHours);
    entry.netHours = this.round(entry.netHours + net);
    entry.daysWorked += 1;
    map.set(key, entry);
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

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
