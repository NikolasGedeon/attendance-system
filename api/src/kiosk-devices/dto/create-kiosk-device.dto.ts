import { IsOptional, IsString, MinLength } from 'class-validator';

/** Admin create payload for a kiosk device (tablet). */
export class CreateKioskDeviceDto {
  @IsString()
  @MinLength(2)
  name: string;

  /** Physical location this tablet lives at. Optional at create time; the
   * device cannot process attendance until it is assigned. */
  @IsOptional()
  @IsString()
  locationId?: string;

  /** Optional legacy free-text label (kept for backward compatibility). */
  @IsOptional()
  @IsString()
  location?: string;

  /** Optional explicit device key. Generated server-side when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  deviceKey?: string;
}
