import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** Token lifetimes. Access-token TTL lives in auth.module signOptions. */
const REFRESH_TOKEN_DAYS = 30;
const PASSWORD_CHANGE_TOKEN_TTL = '10m';
const RESET_TOKEN_TTL_MINUTES = 15;

/** Forgot-password abuse protection (in-memory, per instance). */
const FORGOT_EMAIL_COOLDOWN_MS = 60 * 1000;
const FORGOT_IP_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_IP_MAX_PER_WINDOW = 5;

const GENERIC_FORGOT_RESPONSE = {
  message:
    'If an account exists for this email, a password reset link has been sent.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** email -> last request timestamp */
  private readonly forgotEmailCooldown = new Map<string, number>();
  /** ip -> request timestamps inside the window */
  private readonly forgotIpRequests = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async signAccessToken(user: User): Promise<string> {
    return this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion,
    });
  }

  private async signPasswordChangeToken(user: User): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        scope: 'password_change',
        tv: user.tokenVersion,
      },
      { expiresIn: PASSWORD_CHANGE_TOKEN_TTL },
    );
  }

  /** Creates a refresh token row (hash only) and returns the raw token. */
  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.sha256(raw),
        expiresAt,
      },
    });
    return raw;
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Normal session payload (login contract, requiresPasswordChange=false). */
  private async sessionResponse(user: User) {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(user),
      this.issueRefreshToken(user.id),
    ]);
    return {
      requiresPasswordChange: false as const,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    };
  }

  private validateNewPasswordPair(newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }
  }

  /**
   * Applies a user-chosen password: updates the hash, clears
   * mustChangePassword, stamps passwordChangedAt, bumps tokenVersion
   * (invalidating all outstanding JWTs) and revokes refresh tokens.
   * Returns the updated user.
   */
  private async applyNewPassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return updated;
  }

  // -------------------------------------------------------------------
  // Register / login
  // -------------------------------------------------------------------

  async register(registerDto: RegisterDto) {
    const { fullName, email, password } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Self-registered users chose their own password: no forced change.
    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    return {
      message: 'User registered successfully',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Server-controlled first-login flow: the ONLY signal is the DB flag.
    if (user.mustChangePassword) {
      return {
        requiresPasswordChange: true as const,
        passwordChangeToken: await this.signPasswordChangeToken(user),
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
      };
    }

    return this.sessionResponse(user);
  }

  // -------------------------------------------------------------------
  // Refresh / logout
  // -------------------------------------------------------------------

  async refresh(rawRefreshToken: string) {
    const tokenHash = this.sha256(rawRefreshToken.trim());
    const now = new Date();

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !record ||
      record.revokedAt ||
      record.expiresAt <= now ||
      !record.user.isActive ||
      !record.user.passwordHash
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (record.user.mustChangePassword) {
      // Admin assigned a new temporary password since this session started.
      throw new UnauthorizedException('Password change required. Log in again.');
    }

    // Rotate: revoke the used token, issue a fresh pair.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: now },
    });

    return this.sessionResponse(record.user);
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = this.sha256(rawRefreshToken.trim());
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out' };
  }

  // -------------------------------------------------------------------
  // Password change (temporary + normal)
  // -------------------------------------------------------------------

  async changeTemporaryPassword(userId: string, dto: ChangePasswordDto) {
    return this.changePasswordInternal(userId, dto);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    return this.changePasswordInternal(userId, dto);
  }

  private async changePasswordInternal(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash || !user.isActive) {
      throw new UnauthorizedException('Invalid session');
    }

    const currentOk = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    this.validateNewPasswordPair(dto.newPassword, dto.confirmPassword);

    const sameAsCurrent = await bcrypt.compare(
      dto.newPassword,
      user.passwordHash,
    );
    if (sameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const updated = await this.applyNewPassword(user.id, dto.newPassword);

    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
        metadata: { viaTemporaryFlow: user.mustChangePassword },
      },
    });

    return this.sessionResponse(updated);
  }

  // -------------------------------------------------------------------
  // Forgot / reset password (email link)
  // -------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto, ip: string | undefined) {
    const email = dto.email.trim().toLowerCase();
    const now = Date.now();

    // Per-IP rate limit.
    if (ip) {
      const timestamps = (this.forgotIpRequests.get(ip) ?? []).filter(
        (t) => now - t < FORGOT_IP_WINDOW_MS,
      );
      if (timestamps.length >= FORGOT_IP_MAX_PER_WINDOW) {
        // Same generic answer: no signal for enumeration or probing.
        return GENERIC_FORGOT_RESPONSE;
      }
      timestamps.push(now);
      this.forgotIpRequests.set(ip, timestamps);
    }

    // Per-email cooldown.
    const lastRequest = this.forgotEmailCooldown.get(email);
    if (lastRequest && now - lastRequest < FORGOT_EMAIL_COOLDOWN_MS) {
      return GENERIC_FORGOT_RESPONSE;
    }
    this.forgotEmailCooldown.set(email, now);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || !user.passwordHash) {
      return GENERIC_FORGOT_RESPONSE;
    }

    try {
      // Invalidate prior unused tokens, then create the new one.
      const raw = randomBytes(32).toString('hex');
      const expiresAt = new Date(now + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.sha256(raw),
            expiresAt,
          },
        }),
      ]);

      await this.emailService.sendPasswordResetEmail(
        user.email as string,
        raw,
        RESET_TOKEN_TTL_MINUTES,
      );
    } catch (error) {
      // Never leak failures to the caller; log without the token.
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Password reset email failed: ${detail}`);
    }

    return GENERIC_FORGOT_RESPONSE;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.sha256(dto.token.trim());
    const now = new Date();

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt <= now) {
      throw new BadRequestException(
        'This reset link is invalid or has expired. Please request a new one.',
      );
    }

    if (!record.user.isActive) {
      throw new BadRequestException(
        'This account is inactive. Please contact admin.',
      );
    }

    this.validateNewPasswordPair(dto.newPassword, dto.confirmPassword);

    // The user chose this password: mustChangePassword must end up false,
    // so the first-login screen does NOT appear after an email reset.
    await this.applyNewPassword(record.userId, dto.newPassword);

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: record.userId,
        action: 'PASSWORD_RESET_BY_EMAIL',
        entityType: 'User',
        entityId: record.userId,
        metadata: {},
      },
    });

    return {
      message: 'Password has been reset. You can now log in.',
    };
  }
}
