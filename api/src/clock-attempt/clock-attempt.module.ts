import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ClockAttemptService } from './clock-attempt.service';

@Module({
  imports: [PrismaModule],
  providers: [ClockAttemptService],
  exports: [ClockAttemptService],
})
export class ClockAttemptModule {}
