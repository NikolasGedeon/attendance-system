import { EmployeeType, Role } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  // string = set email, null = remove email (card-only user)
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // string = assign location, null = remove location, undefined = no change
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  // string = assign position, null = remove position, undefined = no change
  @IsOptional()
  @IsUUID()
  positionId?: string | null;

  @IsOptional()
  @IsEnum(EmployeeType)
  employeeType?: EmployeeType;

  // Empty string clears the value.
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  cardUid?: string;

  @IsOptional()
  @IsBoolean()
  requireOtpForCard?: boolean;

  @IsOptional()
  @IsBoolean()
  hasMobile?: boolean;
}
