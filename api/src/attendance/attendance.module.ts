import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AttendanceController } from './attendance.controller';
import { AttendanceReportsService } from './attendance-reports.service';
import { AttendanceService } from './attendance.service';
import { AttendanceAutoCloseService } from './attendance-autoclose.service';
import { ClockAttemptModule } from '../clock-attempt/clock-attempt.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ClockAttemptModule, ScheduleModule.forRoot()],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceReportsService,
    AttendanceAutoCloseService,
  ],
})
export class AttendanceModule {}
