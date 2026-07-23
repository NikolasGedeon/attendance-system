import { AttendanceReportsService } from './attendance-reports.service';

const D = (iso: string) => new Date(iso);

const userA = {
  id: 'A',
  fullName: 'Alice Example',
  email: 'alice@example.com',
  employeeCode: 'E1',
  employeeType: 'INTERNAL',
  department: 'Ops',
  position: { name: 'Cleaner' },
  location: { name: 'HQ' },
};
const userB = {
  id: 'B',
  fullName: '=Bob Example', // starts with '=' to exercise CSV sanitisation
  email: 'bob@example.com',
  employeeCode: 'E2',
  employeeType: 'EXTERNAL',
  department: null,
  position: null,
  location: null,
};

const attendanceRows = [
  // Alice, 2026-07-15: two completed sessions (3h + 3h = 6h) -> MULTIPLE_RECORDS
  { id: 'a1', userId: 'A', clockIn: D('2026-07-15T04:00:00Z'), clockOut: D('2026-07-15T07:00:00Z'), methodIn: 'MOBILE_QR', methodOut: 'MOBILE_QR', latitude: 34.9, longitude: 33.6, isEdited: false, user: userA },
  { id: 'a2', userId: 'A', clockIn: D('2026-07-15T08:00:00Z'), clockOut: D('2026-07-15T11:00:00Z'), methodIn: 'MOBILE_QR', methodOut: 'MOBILE_QR', latitude: null, longitude: null, isEdited: false, user: userA },
  // Alice, 2026-07-16: open record
  { id: 'a3', userId: 'A', clockIn: D('2026-07-16T05:00:00Z'), clockOut: null, methodIn: 'CARD', methodOut: null, latitude: null, longitude: null, isEdited: false, user: userA },
  // Bob, 2026-07-15: 30h session (overnight + manually adjusted) -> pushes grand total past 24h
  { id: 'b1', userId: 'B', clockIn: D('2026-07-15T05:00:00Z'), clockOut: D('2026-07-16T11:00:00Z'), methodIn: 'MANUAL', methodOut: 'MANUAL', latitude: null, longitude: null, isEdited: true, user: userB },
];

function makeService(rows: any[]) {
  const prisma: any = {
    attendance: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return new AttendanceReportsService(prisma);
}

describe('AttendanceReportsService.getAdvancedReport', () => {
  it('aggregates integer seconds with the 45-minute break and exceptions', async () => {
    const service = makeService(attendanceRows);
    const report = await service.getAdvancedReport({
      dateFrom: '2026-07-15',
      dateTo: '2026-07-16',
    });

    expect(report.timezone).toBe('Europe/Nicosia');
    expect(report.breakSecondsPerDay).toBe(2700);
    expect(report.breakPolicy).toContain('45 minutes');
    expect(report.usersCount).toBe(2);

    const alice = report.users.find((u: any) => u.user.id === 'A');
    expect(alice.totals.grossSeconds).toBe(21600); // 6h
    expect(alice.totals.breakSeconds).toBe(2700);
    expect(alice.totals.netSeconds).toBe(18900); // 05:15
    expect(alice.totals.netDisplay).toBe('05:15');
    expect(alice.totals.daysWorked).toBe(2); // completed day + open day

    const day1 = alice.days.find((d: any) => d.date === '2026-07-15');
    expect(day1.grossDisplay).toBe('06:00');
    expect(day1.statuses).toContain('MULTIPLE_RECORDS');
    expect(day1.sessions).toHaveLength(2);

    const day2 = alice.days.find((d: any) => d.date === '2026-07-16');
    expect(day2.grossSeconds).toBe(0);
    expect(day2.hasOpenRecord).toBe(true);
    expect(day2.statuses).toContain('OPEN_RECORD');

    const bob = report.users.find((u: any) => u.user.id === 'B');
    expect(bob.totals.grossSeconds).toBe(108000); // 30h
    expect(bob.totals.netSeconds).toBe(105300);
    expect(bob.days[0].statuses).toEqual(
      expect.arrayContaining(['OVERNIGHT_SHIFT', 'MANUALLY_ADJUSTED']),
    );

    // Grand totals sum integer seconds (no repeated decimal rounding).
    expect(report.grandTotal.grossSeconds).toBe(129600);
    expect(report.grandTotal.netSeconds).toBe(124200);
    expect(report.grandTotal.daysWorked).toBe(3);

    expect(report.exceptionCounts.OPEN_RECORD).toBe(1);
    expect(report.exceptionCounts.MULTIPLE_RECORDS).toBe(1);
    expect(report.exceptionCounts.OVERNIGHT_SHIFT).toBe(1);
    expect(report.exceptionCounts.MANUALLY_ADJUSTED).toBe(1);

    // Backward-compat decimal hours still present.
    expect(alice.totals.netHours).toBe(5.25);
  });
});

describe('AttendanceReportsService.buildAdvancedWorkbook (Excel)', () => {
  it('writes numeric duration cells with [h]:mm and clean total rows', async () => {
    const service = makeService(attendanceRows);
    const wb = await service.buildAdvancedWorkbook({
      dateFrom: '2026-07-15',
      dateTo: '2026-07-16',
    });

    const sheetNames = wb.worksheets.map((w) => w.name);
    expect(sheetNames).toEqual(
      expect.arrayContaining([
        'Dashboard',
        'Attendance Detail',
        'Employee Summary',
        'Daily Summary',
        'Exceptions',
        'Applied Filters',
      ]),
    );

    const emp = wb.getWorksheet('Employee Summary')!;
    let grandRow: any = null;
    emp.eachRow((row) => {
      if (row.getCell(1).value === 'GRAND TOTAL') grandRow = row;
    });
    expect(grandRow).not.toBeNull();

    // Gross column (8) is a real number, formatted [h]:mm, and > 1 day (>24h).
    const grossCell = grandRow.getCell(8);
    expect(typeof grossCell.value).toBe('number');
    expect(grossCell.value).toBeGreaterThan(1); // 129600/86400 = 1.5
    expect(grossCell.numFmt).toBe('[h]:mm');

    // Unrelated columns on the total row must be blank (fixes stray values).
    expect(grandRow.getCell(2).value == null || grandRow.getCell(2).value === '').toBe(true);
    expect(grandRow.getCell(5).value == null || grandRow.getCell(5).value === '').toBe(true);

    // A per-session detail duration cell is numeric with [h]:mm.
    const detail = wb.getWorksheet('Attendance Detail')!;
    const firstData = detail.getRow(2);
    const durCell = firstData.getCell(10);
    expect(typeof durCell.value).toBe('number');
    expect(durCell.numFmt).toBe('[h]:mm');

    // Applied Filters sheet states the 45-minute policy.
    const filtersSheet = wb.getWorksheet('Applied Filters')!;
    let sawPolicy = false;
    filtersSheet.eachRow((row) => {
      if (String(row.getCell(2).value ?? '').includes('45 minutes')) sawPolicy = true;
    });
    expect(sawPolicy).toBe(true);
  });
});

describe('AttendanceReportsService.buildAdvancedCsv (CSV)', () => {
  it('uses human-readable durations and sanitises formula injection', async () => {
    const service = makeService(attendanceRows);
    const csv = await service.buildAdvancedCsv({
      dateFrom: '2026-07-15',
      dateTo: '2026-07-16',
    });

    expect(csv).toContain('06:00'); // gross HH:mm
    expect(csv).toContain('05:15'); // net HH:mm
    expect(csv).toContain("'=Bob Example"); // formula-injection neutralised
    expect(csv).not.toContain('0.03125'); // no Excel day-fractions in CSV
  });
});
