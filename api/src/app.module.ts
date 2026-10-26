import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LocationsModule } from './locations/locations.module';
import { UsersModule } from './users/users.module';
import { KioskModule } from './kiosk/kiosk.module';
import { KioskQrModule } from './kiosk-qr/kiosk-qr.module';
import { KioskDevicesModule } from './kiosk-devices/kiosk-devices.module';
import { KioskEnrollmentModule } from './kiosk-enrollment/kiosk-enrollment.module';
import { ManagerModule } from './manager/manager.module';
import { CompaniesModule } from './companies/companies.module';
import { MobileTokenModule } from './mobile-token/mobile-token.module';
import { PositionsModule } from './positions/positions.module';
import { PrivacyModule } from './privacy/privacy.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AttendanceModule,
    LocationsModule,
    UsersModule,
    KioskModule,
    KioskQrModule,
    KioskDevicesModule,
    KioskEnrollmentModule,
    ManagerModule,
    CompaniesModule,
    PositionsModule,
    MobileTokenModule,
    PrivacyModule,
  ],
})
export class AppModule {}