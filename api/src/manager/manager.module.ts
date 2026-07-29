import { Module } from '@nestjs/common';
import { ClockAttemptModule } from '../clock-attempt/clock-attempt.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';

@Module({
  imports: [PrismaModule, ClockAttemptModule],
  controllers: [ManagerController],
  providers: [ManagerService],
})
export class ManagerModule {}
