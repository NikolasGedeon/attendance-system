import { IsISO8601, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Mobile employee clock-out payload (POST /attendance/clock-out).
 *
 * Type-level validation lives here; semantic checks (presence, coordinate
 * range, GPS-fix freshness) and geofence enforcement live in AttendanceService
 * so they can return stable machine-readable error codes.
 *
 * The client MUST NOT supply an authoritative attendance method — the backend
 * already knows this endpoint is the authenticated mobile flow, and any extra
 * fields are stripped by the global ValidationPipe (whitelist: true).
 */
export class ClockOutDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  latitude?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  longitude?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracyMeters?: number;

  /** GPS-fix timestamp (ISO-8601). Used ONLY for freshness — never as the clock-out time. */
  @IsOptional()
  @IsISO8601()
  capturedAt?: string;
}
