import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';

@Module({
  imports: [PrismaModule, SmsModule],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
