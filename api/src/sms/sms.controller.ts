import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SmsService } from './sms.service';

export class TestSmsDto {
  @IsString()
  @IsNotEmpty()
  to: string; // +35796660416, 0035796660416 or 96660416 (Cyta)

  @IsOptional()
  @IsString()
  message?: string;
}

/**
 * Admin-only SMS test endpoint for the ACTIVE provider (SMS_PROVIDER).
 * For Cyta it always returns the parsed status, lot and RAW response
 * body — even on failure — so misconfiguration can be diagnosed.
 * Remove or disable once SMS is confirmed working in production.
 */
@Controller('sms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('test')
  async sendTest(@Body() dto: TestSmsDto) {
    if (!this.smsService.smsEnabled) {
      throw new BadRequestException(
        'SMS_ENABLED is not "true" in .env — enable it and restart the server.',
      );
    }

    const to = dto.to.trim();
    const message = dto.message?.trim() || 'Attendance system SMS test';
    const provider = this.smsService.provider;

    try {
      if (provider === 'cyta') {
        const result = await this.smsService.sendCytaRaw(to, message);
        return {
          success: result.ok,
          provider: 'cyta',
          to: result.to,
          parsedStatus: result.status,
          lot: result.lot,
          providerResponse: result.raw,
        };
      }

      const twilioMessage = await this.smsService.sendTwilioRaw(to, message);
      return {
        success: true,
        provider,
        sid: twilioMessage.sid,
        status: twilioMessage.status,
        to: twilioMessage.to,
        from: twilioMessage.from,
        note: 'Accepted by Twilio. Check Twilio Console > Monitor > Logs for final delivery status.',
      };
    } catch (error) {
      // Config / number errors are already user-safe BadRequests.
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: number })?.code;
      throw new BadRequestException(
        `${provider} error${code ? ` ${code}` : ''}: ${detail}`,
      );
    }
  }
}
