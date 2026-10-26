import { Body, Controller, Post } from '@nestjs/common';
import { RegisterCodeDto } from './dto/register-code.dto';
import { RegisterStartDto } from './dto/register-start.dto';
import { KioskEnrollmentService } from './kiosk-enrollment.service';

/**
 * PUBLIC kiosk self-registration (no JWT). A fresh universal-APK install uses
 * these routes to obtain and redeem a one-time registration code. There is no
 * device key yet, so these endpoints are intentionally unauthenticated; the
 * registration code itself is the short-lived, single-use bearer secret.
 */
@Controller('kiosk/register')
export class KioskRegistrationController {
  constructor(private readonly service: KioskEnrollmentService) {}

  @Post('start')
  start(@Body() dto: RegisterStartDto) {
    return this.service.start(dto);
  }

  @Post('poll')
  poll(@Body() dto: RegisterCodeDto) {
    return this.service.poll(dto.code);
  }

  @Post('confirm')
  confirm(@Body() dto: RegisterCodeDto) {
    return this.service.confirm(dto.code);
  }
}
