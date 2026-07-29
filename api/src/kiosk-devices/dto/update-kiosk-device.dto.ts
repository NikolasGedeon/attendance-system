import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/** Admin update payload for a kiosk device. */
export class UpdateKioskDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
