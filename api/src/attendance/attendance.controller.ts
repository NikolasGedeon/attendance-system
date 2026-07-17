import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AttendanceReportsService } from './attendance-reports.service';
import type { ReportFilters } from './attendance-reports.service';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly reportsService: AttendanceReportsService,
  ) {}

  @Post('clock-in')
  clockIn(
    @Request() req,
    @Body() body: { latitude?: number; longitude?: number },
  ) {
    return this.attendanceService.clockIn(
      req.user.id,
      body.latitude,
      body.longitude,
    );
  }

  @Post('clock-out')
  clockOut(@Request() req) {
    return this.attendanceService.clockOut(req.user.id);
  }

  @Get('me')
  getMyAttendance(@Request() req) {
    return this.attendanceService.getMyAttendance(req.user.id);
  }

  @Get('status')
  getStatus(@Request() req) {
    return this.attendanceService.getStatus(req.user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getAllAttendance(
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.attendanceService.getAllAttendance({
      userId,
      from,
      to,
    });
  }

  @Get('reports/monthly')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getMonthlyReport(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.attendanceService.getMonthlyReport(
      Number(year),
      Number(month),
    );
  }

  @Get('reports/daily')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getDailyReport(@Query('date') date: string) {
    return this.attendanceService.getDailyReport(date);
  }

  @Get('reports/advanced')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getAdvancedReport(@Query() query: ReportFilters) {
    return this.reportsService.getAdvancedReport(query);
  }

  @Get('reports/advanced/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportAdvancedReport(
    @Query() query: ReportFilters & { format?: string },
    @Res() res: Response,
  ) {
    const wb = await this.reportsService.buildAdvancedWorkbook(query);
    await this.sendWorkbook(
      res,
      wb,
      `attendance-report-${query.dateFrom ?? 'from'}_${query.dateTo ?? 'to'}`,
      query.format,
    );
  }

  @Get('reports/absence')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getAbsenceReport(@Query() query: ReportFilters) {
    return this.reportsService.getAbsenceReport(query);
  }

  @Get('reports/absence/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  async exportAbsenceReport(
    @Query() query: ReportFilters & { format?: string },
    @Res() res: Response,
  ) {
    const wb = await this.reportsService.buildAbsenceWorkbook(query);
    await this.sendWorkbook(
      res,
      wb,
      `absence-report-${query.dateFrom ?? 'from'}_${query.dateTo ?? 'to'}`,
      query.format,
    );
  }

  @Get(':id/adjustments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getAttendanceAdjustments(@Param('id') id: string) {
    return this.attendanceService.getAttendanceAdjustments(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  updateAttendance(
    @Param('id') id: string,
    @Request() req,
    @Body()
    body: {
      clockIn?: string;
      clockOut?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      reason: string;
    },
  ) {
    return this.attendanceService.updateAttendance(id, req.user.id, body);
  }

  /** Writes the workbook as .xlsx (default) or .csv of the first sheet. */
  private async sendWorkbook(
    res: Response,
    wb: ExcelJS.Workbook,
    baseName: string,
    format?: string,
  ) {
    if ((format || '').toLowerCase() === 'csv') {
      const buffer = await wb.csv.writeBuffer();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${baseName}.csv"`,
      );
      res.send(Buffer.from(buffer));
      return;
    }

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${baseName}.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  }
}
