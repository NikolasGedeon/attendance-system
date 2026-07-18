import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskQrController } from './kiosk-qr.controller';
import { KioskQrService } from './kiosk-qr.service';

@Module({
  imports: [PrismaModule],
  controllers: [KioskQrController],
  providers: [KioskQrService],
})
export class KioskQrModule {}
