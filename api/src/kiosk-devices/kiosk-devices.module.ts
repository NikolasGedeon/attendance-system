import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskDevicesController } from './kiosk-devices.controller';
import { KioskDevicesService } from './kiosk-devices.service';

@Module({
  imports: [PrismaModule],
  controllers: [KioskDevicesController],
  providers: [KioskDevicesService],
})
export class KioskDevicesModule {}
