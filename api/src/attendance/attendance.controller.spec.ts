import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceReportsService } from './attendance-reports.service';

describe('AttendanceController', () => {
  let module: TestingModule;
  let controller: AttendanceController;

  const attendanceServiceMock = {
    clockIn: jest.fn(),
    clockOut: jest.fn(),
    getMyAttendance: jest.fn(),
    getStatus: jest.fn(),
    getAllAttendance: jest.fn(),
    getMonthlyReport: jest.fn(),
    getDailyReport: jest.fn(),
    getAttendanceAdjustments: jest.fn(),
    updateAttendance: jest.fn(),
  };

  const reportsServiceMock = {
    getAdvancedReport: jest.fn(),
    buildAdvancedWorkbook: jest.fn(),
    buildAdvancedCsv: jest.fn(),
    getAbsenceReport: jest.fn(),
    buildAbsenceWorkbook: jest.fn(),
    buildAbsenceCsv: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        { provide: AttendanceService, useValue: attendanceServiceMock },
        { provide: AttendanceReportsService, useValue: reportsServiceMock },
      ],
    }).compile();
    controller = module.get<AttendanceController>(AttendanceController);
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await module.close();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('getStatus delegates to AttendanceService with the user id', async () => {
    attendanceServiceMock.getStatus.mockResolvedValue({ isClockedIn: false });
    await controller.getStatus({ user: { id: 'u1' } } as any);
    expect(attendanceServiceMock.getStatus).toHaveBeenCalledWith('u1');
  });
});
