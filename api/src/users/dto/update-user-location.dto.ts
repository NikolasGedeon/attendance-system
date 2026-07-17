import { IsOptional, IsUUID } from 'class-validator';

export class UpdateUserLocationDto {
  // string = assign location, null (or omitted) = remove location
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
}
