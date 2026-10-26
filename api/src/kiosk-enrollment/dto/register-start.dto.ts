import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload a fresh (unregistered) tablet sends to request a registration code. */
export class RegisterStartDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceSerial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appVersion?: string;
}
