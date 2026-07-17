import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Rotating mobile attendance tokens (dynamic, per logged-in user). */
const TOKEN_TTL_SECONDS = 15;

@Injectable()
export class MobileTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a short-lived, single-use token for the logged-in user.
   * Only the SHA-256 hash is stored; the raw token is returned once.
   * Any previous unused tokens for the same user are invalidated so
   * exactly one token is valid at a time.
   */
  async generateToken(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not active');
    }

    // Invalidate previous unused tokens for this user.
    await this.prisma.mobileAttendanceToken.deleteMany({
      where: { userId, usedAt: null },
    });

    const token = randomBytes(16).toString('hex'); // 32 hex chars
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    await this.prisma.mobileAttendanceToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    return {
      token,
      expiresAt,
      refreshInSeconds: TOKEN_TTL_SECONDS,
    };
  }
}
