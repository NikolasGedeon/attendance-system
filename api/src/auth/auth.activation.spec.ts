import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

const now = Date.now();

function tokenRecord(over: any = {}) {
  return {
    id: 't1',
    userId: 'u1',
    purpose: 'ACCOUNT_ACTIVATION',
    usedAt: null,
    invalidatedAt: null,
    expiresAt: new Date(now + 3600_000),
    user: { id: 'u1', email: 'nikolas@example.com', isActive: true, isActivated: false },
    ...over,
  };
}

function makePrisma(over: any = {}) {
  const calls: any[] = [];
  const rec = (name: string) => jest.fn((args: any) => {
    calls.push({ name, args });
    return {};
  });
  const prisma: any = {
    user: {
      findUnique: jest.fn(async (a: any) => (over.userFind ? over.userFind(a) : null)),
      update: rec('user.update'),
    },
    userSecurityToken: {
      findUnique: jest.fn(async () => (over.tokenFind ? over.tokenFind() : null)),
      update: rec('tok.update'),
      updateMany: rec('tok.updateMany'),
    },
    refreshToken: { create: jest.fn(async () => ({})), updateMany: rec('rt.updateMany') },
    auditLog: { create: jest.fn(async (a: any) => { calls.push({ name: 'audit', args: a }); return {}; }) },
    $transaction: jest.fn(async (ops: any[]) => ops),
  };
  return { prisma, calls };
}
const jwt: any = { signAsync: jest.fn(async () => 'jwt') };
const email: any = { sendWelcomeActivationEmail: jest.fn(async () => undefined) };

async function code(fn: () => Promise<any>) {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (e: any) {
    const r = e?.getResponse?.();
    return r?.code ?? e?.constructor?.name;
  }
}

describe('AuthService.activateAccount', () => {
  const dto = (over: any = {}) => ({
    token: 'raw',
    password: 'longenough1',
    confirmPassword: 'longenough1',
    ...over,
  });

  it('activates: sets password + activated, invalidates other tokens, audits', async () => {
    const { prisma, calls } = makePrisma({ tokenFind: () => tokenRecord() });
    const svc = new AuthService(prisma, jwt, email);
    const res: any = await svc.activateAccount(dto() as any);
    expect(res.success).toBe(true);
    const u = calls.find((c) => c.name === 'user.update');
    expect(u.args.data.isActivated).toBe(true);
    expect(u.args.data.mustChangePassword).toBe(false);
    expect(typeof u.args.data.passwordHash).toBe('string');
    expect(calls.some((c) => c.name === 'tok.update')).toBe(true);
    expect(calls.some((c) => c.name === 'tok.updateMany')).toBe(true);
    expect(calls.some((c) => c.name === 'audit' && c.args.data.action === 'ACCOUNT_ACTIVATED')).toBe(true);
  });

  it('rejects invalid / used / expired / inactive / already-activated', async () => {
    expect(await code(() => new AuthService(makePrisma({ tokenFind: () => null }).prisma, jwt, email).activateAccount(dto() as any))).toBe('ACTIVATION_TOKEN_INVALID');
    expect(await code(() => new AuthService(makePrisma({ tokenFind: () => tokenRecord({ usedAt: new Date() }) }).prisma, jwt, email).activateAccount(dto() as any))).toBe('ACTIVATION_TOKEN_USED');
    expect(await code(() => new AuthService(makePrisma({ tokenFind: () => tokenRecord({ expiresAt: new Date(now - 1000) }) }).prisma, jwt, email).activateAccount(dto() as any))).toBe('ACTIVATION_TOKEN_EXPIRED');
    expect(await code(() => new AuthService(makePrisma({ tokenFind: () => tokenRecord({ user: { id: 'u1', email: 'e', isActive: false, isActivated: false } }) }).prisma, jwt, email).activateAccount(dto() as any))).toBe('ACCOUNT_INACTIVE');
    expect(await code(() => new AuthService(makePrisma({ tokenFind: () => tokenRecord({ user: { id: 'u1', email: 'e', isActive: true, isActivated: true } }) }).prisma, jwt, email).activateAccount(dto() as any))).toBe('ALREADY_ACTIVATED');
  });

  it('rejects weak password and mismatch', async () => {
    const svc = () => new AuthService(makePrisma({ tokenFind: () => tokenRecord() }).prisma, jwt, email);
    expect(await code(() => svc().activateAccount(dto({ password: 'short', confirmPassword: 'short' }) as any))).toBe('PASSWORD_TOO_WEAK');
    expect(await code(() => svc().activateAccount(dto({ confirmPassword: 'different1' }) as any))).toBe('PASSWORD_MISMATCH');
  });
});

describe('AuthService.login activation gate', () => {
  it('returns stable codes for each state', async () => {
    expect(await code(() => new AuthService(makePrisma().prisma, jwt, email).login({ email: 'x', password: 'p' } as any))).toBe('INVALID_CREDENTIALS');
    expect(await code(() => new AuthService(makePrisma({ userFind: () => ({ id: 'u', isActive: false, isActivated: true, passwordHash: 'h' }) }).prisma, jwt, email).login({ email: 'x', password: 'p' } as any))).toBe('ACCOUNT_INACTIVE');
    expect(await code(() => new AuthService(makePrisma({ userFind: () => ({ id: 'u', isActive: true, isActivated: false, passwordHash: null }) }).prisma, jwt, email).login({ email: 'x', password: 'p' } as any))).toBe('ACCOUNT_ACTIVATION_REQUIRED');
  });

  it('logs in an activated user with the correct password', async () => {
    const passwordHash = await bcrypt.hash('correcthorse', 10);
    const { prisma } = makePrisma({
      userFind: () => ({ id: 'u', fullName: 'U', email: 'x@x.com', role: 'EMPLOYEE', isActive: true, isActivated: true, mustChangePassword: false, passwordHash, tokenVersion: 0 }),
    });
    const res: any = await new AuthService(prisma, jwt, email).login({ email: 'x@x.com', password: 'correcthorse' } as any);
    expect(res.requiresPasswordChange).toBe(false);
    expect(res.accessToken).toBeTruthy();
  });
});

describe('AuthService.activationStatus', () => {
  it('returns masked email when valid and a reason when not', async () => {
    const ok: any = await new AuthService(makePrisma({ tokenFind: () => tokenRecord() }).prisma, jwt, email).activationStatus('raw');
    expect(ok.valid).toBe(true);
    expect(ok.emailMasked).toBe('n***@example.com');
    const bad: any = await new AuthService(makePrisma({ tokenFind: () => tokenRecord({ usedAt: new Date() }) }).prisma, jwt, email).activationStatus('raw');
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe('ACTIVATION_TOKEN_USED');
  });
});
