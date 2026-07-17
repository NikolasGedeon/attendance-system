import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LocationsModule } from './locations/locations.module';
import { UsersModule } from './users/users.module';
import { KioskModule } from './kiosk/kiosk.module';
import { MobileTokenModule } from './mobile-token/mobile-token.module';
import { PositionsModule } from './positions/positions.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AttendanceModule,
    LocationsModule,
    UsersModule,
    KioskModule,
    PositionsModule,
    MobileTokenModule,
  ],
})
export class AppModule {}