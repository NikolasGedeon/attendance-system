import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Strategy for the RESTRICTED password-change token issued at first login
 * (mustChangePassword=true). Accepts ONLY tokens carrying
 * scope=password_change; the normal JwtStrategy rejects them, so this
 * token cannot reach attendance or any other endpoint.
 */
@Injectable()
export class PasswordChangeStrategy extends PassportStrategy(
  Strategy,
  'password-change',
) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }

  async validate(payload: any) {
    if (payload.scope !== 'password_change') {
      throw new UnauthorizedException('Password-change token required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, tokenVersion: true },
    });

    if (!user || !user.isActive || user.tokenVersion !== (payload.tv ?? 0)) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return { id: payload.sub, scope: payload.scope };
  }
}

@Injectable()
export class PasswordChangeAuthGuard extends AuthGuard('password-change') {}
