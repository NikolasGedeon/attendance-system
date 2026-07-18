import {
  Body,
  Controller,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChallengeStatusDto } from './dto/challenge-status.dto';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { ScanKioskQrDto } from './dto/scan-kiosk-qr.dto';
import { KioskQrService } from './kiosk-qr.service';

/**
 * Kiosk-displayed QR clocking.
 * Challenge creation/polling authenticate with the kiosk device key
 * (same model as /kiosk/*; POST keeps the key out of URLs and logs).
 * Consumption (/scan) is a JWT employee endpoint.
 */
@Controller('kiosk-qr')
export class KioskQrController {
  constructor(private readonly kioskQrService: KioskQrService) {}

  @Post('challenge')
  createChallenge(@Body() dto: CreateChallengeDto) {
    return this.kioskQrService.createChallenge(dto.kioskDeviceKey);
  }

  @Post('challenge/:id/status')
  getChallengeStatus(
    @Param('id') id: string,
    @Body() dto: ChallengeStatusDto,
  ) {
    return this.kioskQrService.getChallengeStatus(id, dto.kioskDeviceKey);
  }

  @Post('scan')
  @UseGuards(JwtAuthGuard)
  scan(@Request() req: { user: { id: string } }, @Body() dto: ScanKioskQrDto) {
    return this.kioskQrService.scan(req.user.id, dto.token);
  }
}
