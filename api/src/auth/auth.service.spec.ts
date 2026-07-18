import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService password flows', () => {
  let service: AuthService;
  let prisma: any;
  let email: { sendPasswordResetEmail: jest.Mock };

  let tempHash: string;

  const baseUser = () => ({
    id: 'u1',
    fullName: 'Test User',
    email: 'test@marfields.com',
    role: 'EMPLOYEE',
    isActive: true,
    passwordHash: tempHash,
    mustChangePassword: false,
    tokenVersion: 0,
  });

  beforeAll(async () => {
    tempHash = await bcrypt.hash('Temp1234', 10);
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...baseUser() }),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };
    email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };

    const jwt = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
    } as unknown as JwtService;

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      email as unknown as EmailService,
    );
  });

  describe('login', () => {
    it('returns ONLY a restricted token when mustChangePassword=true', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        mustChangePassword: true,
      });

      const result: any = await service.login({
        email: 'test@marfields.com',
        password: 'Temp1234',
      });

      expect(result.requiresPasswordChange).toBe(true);
      expect(result.passwordChangeToken).toBeDefined();
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
    });

    it('returns access+refresh tokens on normal login', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser());

      const result: any = await service.login({
        email: 'test@marfields.com',
        password: 'Temp1234',
      });

      expect(result.requiresPasswordChange).toBe(false);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rejects inactive users', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        isActive: false,
      });
      await expect(
        service.login({ email: 'test@marfields.com', password: 'Temp1234' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('changeTemporaryPassword', () => {
    it('rejects a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        mustChangePassword: true,
      });
      await expect(
        service.changeTemporaryPassword('u1', {
          currentPassword: 'wrong',
          newPassword: 'NewPass123',
          confirmPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects mismatched confirmation', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        mustChangePassword: true,
      });
      await expect(
        service.changeTemporaryPassword('u1', {
          currentPassword: 'Temp1234',
          newPassword: 'NewPass123',
          confirmPassword: 'Different123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects reusing the current password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        mustChangePassword: true,
      });
      await expect(
        service.changeTemporaryPassword('u1', {
          currentPassword: 'Temp1234',
          newPassword: 'Temp1234',
          confirmPassword: 'Temp1234',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('clears mustChangePassword, bumps tokenVersion, revokes sessions', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser(),
        mustChangePassword: true,
      });

      const result: any = await service.changeTemporaryPassword('u1', {
        currentPassword: 'Temp1234',
        newPassword: 'NewPass123',
        confirmPassword: 'NewPass123',
      });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.data.mustChangePassword).toBe(false);
      expect(updateArgs.data.passwordChangedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.tokenVersion).toEqual({ increment: 1 });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', revokedAt: null },
        }),
      );
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.requiresPasswordChange).toBe(false);
    });
  });

  describe('forgotPassword', () => {
    it('returns the generic message for unknown emails and sends nothing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await service.forgotPassword(
        { email: 'nobody@marfields.com' },
        '1.2.3.4',
      );
      expect(res.message).toMatch(/If an account exists/);
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('stores only a hash and emails the raw token for valid users', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser());
      await service.forgotPassword({ email: 'test@marfields.com' }, '1.2.3.4');

      expect(email.sendPasswordResetEmail).toHaveBeenCalled();
      const rawToken = email.sendPasswordResetEmail.mock.calls[0][1];
      const storedHash =
        prisma.passwordResetToken.create.mock.calls[0][0].data.tokenHash;
      expect(storedHash).not.toEqual(rawToken);
      expect(storedHash).toHaveLength(64); // sha256 hex
    });

    it('applies the per-email cooldown (same generic response, one email)', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser());
      await service.forgotPassword({ email: 'test@marfields.com' }, '1.2.3.4');
      await service.forgotPassword({ email: 'test@marfields.com' }, '1.2.3.4');
      expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetPassword', () => {
    it('rejects expired tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: baseUser(),
      });
      await expect(
        service.resetPassword({
          token: 'x',
          newPassword: 'NewPass123',
          confirmPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects used tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        user: baseUser(),
      });
      await expect(
        service.resetPassword({
          token: 'x',
          newPassword: 'NewPass123',
          confirmPassword: 'NewPass123',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resets, ends up with mustChangePassword=false, revokes sessions', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        user: baseUser(),
      });

      await service.resetPassword({
        token: 'x',
        newPassword: 'NewPass123',
        confirmPassword: 'NewPass123',
      });

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.data.mustChangePassword).toBe(false);
      expect(updateArgs.data.tokenVersion).toEqual({ increment: 1 });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      // Token marked used + other unused tokens invalidated.
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', usedAt: null },
        }),
      );
    });
  });
});
