import { IsNotEmpty, IsString } from 'class-validator';

export class AdminVerifyCardDto {
  @IsString()
  @IsNotEmpty()
  adminCardUid: string;

  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;
}