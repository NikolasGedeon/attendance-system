import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KioskEnrollmentsAdminController } from './kiosk-enrollments-admin.controller';
import { KioskEnrollmentService } from './kiosk-enrollment.service';
import { KioskRegistrationController } from './kiosk-registration.controller';

@Module({
  imports: [PrismaModule],
  controllers: [KioskRegistrationController, KioskEnrollmentsAdminController],
  providers: [KioskEnrollmentService],
})
export class KioskEnrollmentModule {}
