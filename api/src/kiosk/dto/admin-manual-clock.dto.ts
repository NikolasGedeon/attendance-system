import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class AdminManualClockDto {
  @IsString()
  @IsNotEmpty()
  adminCardUid: string;

  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;

  @IsString()
  @IsNotEmpty()
  employeeUserId: string;

  @IsString()
  @IsIn(['CLOCK_IN', 'CLOCK_OUT'])
  action: 'CLOCK_IN' | 'CLOCK_OUT';

  @IsString()
  @IsNotEmpty()
  reason: string;
}