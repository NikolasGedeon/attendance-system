import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/** Public account-activation payload (POST /auth/activate-account). */
export class ActivateAccountDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}
