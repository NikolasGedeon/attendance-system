import { BadRequestException } from '@nestjs/common';

/**
 * Single source of truth for the password policy, shared by registration,
 * password reset, temporary-password change, account activation and the
 * optional admin-created password.
 *
 * Stage 3 preserves the EXISTING policy exactly (minimum length 8, and
 * password/confirmation must match). No uppercase/lowercase/number/special
 * requirements are introduced here — changing complexity is a separate,
 * explicit decision.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Throws BadRequestException (with a machine `code`) if the password is too weak. */
export function assertPasswordStrong(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException({
      code: 'PASSWORD_TOO_WEAK',
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
    });
  }
}

/** Throws if the two values differ, else validates strength. */
export function assertPasswordPair(
  password: string,
  confirmPassword: string,
): void {
  if (password !== confirmPassword) {
    throw new BadRequestException({
      code: 'PASSWORD_MISMATCH',
      message: 'Passwords do not match',
    });
  }
  assertPasswordStrong(password);
}
