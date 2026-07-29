import { Module } from '@nestjs/common';
import { ClockAttemptModule } from '../clock-attempt/clock-attempt.module';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskQrController } from './kiosk-qr.controller';
import { KioskQrService } from './kiosk-qr.service';

@Module({
  imports: [PrismaModule, ClockAttemptModule],
  controllers: [KioskQrController],
  providers: [KioskQrService],
})
export class KioskQrModule {}
