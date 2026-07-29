import { IsString } from 'class-validator';

/** Assign a kiosk device to a physical location. */
export class AssignKioskLocationDto {
  @IsString()
  locationId: string;
}
