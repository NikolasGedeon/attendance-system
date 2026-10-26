import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Admin approval: assign a kiosk name and (recommended) a Location. */
export class ApproveEnrollmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  /** Physical Location. Optional here, but the kiosk cannot process
   *  attendance until it has one (enforced by the /kiosk/config gate). */
  @IsOptional()
  @IsString()
  locationId?: string;
}
