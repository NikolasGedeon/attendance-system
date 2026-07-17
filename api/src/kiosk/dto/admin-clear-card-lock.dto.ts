import { IsNotEmpty, IsString } from 'class-validator';

export class AdminClearCardLockDto {
  @IsString()
  @IsNotEmpty()
  adminCardUid: string;

  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;

  @IsString()
  @IsNotEmpty()
  employeeUserId: string;
}
