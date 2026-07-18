import { IsNotEmpty, IsString } from 'class-validator';

export class ScanKioskQrDto {
  /** Opaque token from the kiosk QR (prefix already stripped by the app). */
  @IsString()
  @IsNotEmpty()
  token: string;
}
