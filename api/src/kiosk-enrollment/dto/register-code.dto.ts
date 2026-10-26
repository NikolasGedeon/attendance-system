import { IsString, MaxLength, MinLength } from 'class-validator';

/** A tablet presenting its registration code (poll / confirm). */
export class RegisterCodeDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  code: string;
}
