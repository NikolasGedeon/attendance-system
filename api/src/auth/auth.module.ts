import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordChangeStrategy } from './password-change.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    EmailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
      // Short-lived access tokens; sessions persist via refresh tokens.
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordChangeStrategy],
})
export class AuthModule {}
