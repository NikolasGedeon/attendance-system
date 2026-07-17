import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceReportsService } from './attendance-reports.service';
import { AttendanceService } from './attendance.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceReportsService],
})
export class AttendanceModule {}
