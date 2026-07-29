import { IsString, MinLength } from 'class-validator';

/** Manager clock-in override payload. A reason is mandatory and audited. */
export class ManagerClockInDto {
  @IsString()
  @MinLength(3)
  reason: string;
}
