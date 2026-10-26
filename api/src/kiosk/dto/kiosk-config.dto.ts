import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Payload for POST /kiosk/config (kiosk self-identification at startup). */
export class KioskConfigDto {
  @IsString()
  @MinLength(1)
  kioskDeviceKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deviceInfo?: string;
}
