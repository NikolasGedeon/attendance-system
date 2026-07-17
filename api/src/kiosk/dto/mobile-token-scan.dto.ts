import { IsNotEmpty, IsString } from 'class-validator';

export class MobileTokenScanDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;
}
