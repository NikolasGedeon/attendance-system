import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ManagerClockInDto } from './dto/manager-clock-in.dto';
import { LiveDashboardFilters, ManagerService } from './manager.service';

/**
 * Manager-only surface. Every route requires MANAGER or ADMIN; scope and
 * override eligibility are enforced in the service (never trusted from the
 * client). Employees can never reach these endpoints.
 */
@Controller('manager')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MANAGER, Role.ADMIN)
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('live-attendance')
  liveAttendance(@Request() req) {
    return this.managerService.getLiveAttendance(req.user.id);
  }

  /** Optimized real-time dashboard (KPIs, company chips, event feed). */
  @Get('live-dashboard')
  liveDashboard(@Request() req, @Query() query: LiveDashboardFilters) {
    return this.managerService.getLiveDashboard(req.user.id, query);
  }

  @Get('failed-clock-attempts')
  failedClockAttempts(@Request() req) {
    return this.managerService.getFailedClockAttempts(req.user.id);
  }

  @Post('attendance/:userId/clock-in')
  clockIn(
    @Request() req,
    @Param('userId') userId: string,
    @Body() dto: ManagerClockInDto,
  ) {
    return this.managerService.managerClockIn(req.user.id, userId, dto);
  }
}
