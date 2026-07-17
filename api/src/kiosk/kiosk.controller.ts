import { Body, Controller, Post } from '@nestjs/common';
import { AdminClearCardLockDto } from './dto/admin-clear-card-lock.dto';
import { AdminManualClockDto } from './dto/admin-manual-clock.dto';
import { AdminVerifyCardDto } from './dto/admin-verify-card.dto';
import { CardScanDto } from './dto/card-scan.dto';
import { MobileTokenScanDto } from './dto/mobile-token-scan.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { KioskService } from './kiosk.service';

/**
 * No JWT here: the kiosk authenticates itself with its deviceKey.
 * TODO(hardening): replace with a signed kiosk secret or HMAC per request.
 */
@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Post('card-scan')
  cardScan(@Body() dto: CardScanDto) {
    return this.kioskService.cardScan(dto);
  }

  @Post('card-scan/verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.kioskService.verifyOtp(dto);
  }

  /** Rotating mobile token scan — separate from physical card UIDs. */
  @Post('mobile-token-scan')
  mobileTokenScan(@Body() dto: MobileTokenScanDto) {
    return this.kioskService.mobileTokenScan(dto);
  }

  @Post('admin/verify-card')
  adminVerifyCard(@Body() dto: AdminVerifyCardDto) {
    return this.kioskService.adminVerifyCard(dto);
  }

  @Post('admin/manual-clock')
  adminManualClock(@Body() dto: AdminManualClockDto) {
    return this.kioskService.adminManualClock(dto);
  }

  @Post('admin/clear-card-lock')
  adminClearCardLock(@Body() dto: AdminClearCardLockDto) {
    return this.kioskService.adminClearCardLock(dto);
  }

  @Post('admin/users')
  adminListUsers(@Body() dto: AdminVerifyCardDto) {
    return this.kioskService.adminListUsers(dto);
  }
}
