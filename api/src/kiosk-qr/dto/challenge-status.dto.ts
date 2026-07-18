import { IsNotEmpty, IsString } from 'class-validator';

export class ChallengeStatusDto {
  @IsString()
  @IsNotEmpty()
  kioskDeviceKey: string;
}
