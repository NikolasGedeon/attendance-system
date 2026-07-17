import { IsNotEmpty, IsString } from 'class-validator';

export class CardScanDto {
  @IsString()
  @IsNotEmpty()
  cardUid: string;

  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;
}
