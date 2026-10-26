import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { KioskEnrollmentService } from './kiosk-enrollment.service';

const sha256 = (s: string) =>
  createHash('sha256').update(s.trim().toUpperCase()).digest('hex');

describe('KioskEnrollmentService', () => {
  let prisma: any;
  let service: KioskEnrollmentService;

  beforeEach(() => {
    prisma = {
      kioskEnrollment: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      kiosk: { create: jest.fn() },
      location: { findUnique: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      // $transaction runs the callback with the same mock as the tx client.
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    service = new KioskEnrollmentService(prisma as unknown as PrismaService);
  });

  describe('start', () => {
    it('creates a PENDING enrollment and returns a fresh code', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue(null);
      prisma.kioskEnrollment.create.mockResolvedValue({});

      const res = await service.start({ deviceModel: 'Pixel Tablet' });

      expect(res.status).toBe('PENDING');
      expect(res.code).toHaveLength(8);
      expect(res.pollIntervalSeconds).toBeGreaterThan(0);
      const createArg = prisma.kioskEnrollment.create.mock.calls[0][0].data;
      // The plaintext code is never stored — only its hash + last 4.
      expect(createArg.codeHash).toBe(sha256(res.code));
      expect(createArg.codeLast4).toBe(res.code.slice(-4));
      expect(createArg.status).toBe('PENDING');
      expect(createArg).not.toHaveProperty('code');
      expect(createArg.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('poll', () => {
    it('returns NOT_FOUND for an unknown code', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue(null);
      const res = await service.poll('ZZZZZZZZ');
      expect(res.status).toBe('NOT_FOUND');
    });

    it('returns PENDING while awaiting approval', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
        kiosk: null,
      });
      const res = await service.poll('ABCDEFGH');
      expect(res.status).toBe('PENDING');
    });

    it('lazily EXPIRES a pending code past its expiry', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1),
        kiosk: null,
      });
      const res = await service.poll('ABCDEFGH');
      expect(res.status).toBe('EXPIRED');
      expect(prisma.kioskEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
    });

    it('delivers the device key exactly while APPROVED', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'APPROVED',
        expiresAt: new Date(Date.now() + 60_000),
        kiosk: {
          id: 'k1',
          name: 'GAIA-KIOSK-01',
          deviceKey: 'super-secret',
          locationId: 'gaia',
          locationRef: { id: 'gaia', name: 'GAIA' },
        },
      });
      const res: any = await service.poll('ABCDEFGH');
      expect(res.status).toBe('APPROVED');
      expect(res.deviceKey).toBe('super-secret');
      expect(res.kiosk).toMatchObject({
        id: 'k1',
        name: 'GAIA-KIOSK-01',
        locationAssigned: true,
      });
    });

    it('never returns a key once CONSUMED', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'CONSUMED',
        expiresAt: new Date(Date.now() + 60_000),
        kiosk: { id: 'k1', deviceKey: 'super-secret' },
      });
      const res: any = await service.poll('ABCDEFGH');
      expect(res.status).toBe('CONSUMED');
      expect(res.deviceKey).toBeUndefined();
    });
  });

  describe('confirm', () => {
    it('marks an APPROVED enrollment CONSUMED', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'APPROVED',
      });
      prisma.kioskEnrollment.update.mockResolvedValue({});
      const res = await service.confirm('ABCDEFGH');
      expect(res.status).toBe('CONSUMED');
      expect(prisma.kioskEnrollment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CONSUMED' }),
        }),
      );
    });

    it('is idempotent for an already-consumed code', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'CONSUMED',
      });
      const res = await service.confirm('ABCDEFGH');
      expect(res.status).toBe('CONSUMED');
      expect(prisma.kioskEnrollment.update).not.toHaveBeenCalled();
    });

    it('throws when the code is unknown', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue(null);
      await expect(service.confirm('NOPE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('mints a kiosk + device key and never returns the full key', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'PENDING',
        codeLast4: 'WXYZ',
        deviceModel: 'Pixel Tablet',
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.location.findUnique.mockResolvedValue({ id: 'gaia', name: 'GAIA' });
      prisma.kiosk.create.mockImplementation((arg: any) =>
        Promise.resolve({
          id: 'k1',
          name: arg.data.name,
          locationId: arg.data.locationId,
          deviceKey: arg.data.deviceKey,
          locationRef: { id: 'gaia', name: 'GAIA' },
        }),
      );
      prisma.kioskEnrollment.update.mockResolvedValue({});

      const res: any = await service.approve('admin-1', 'e1', {
        name: 'GAIA-KIOSK-01',
        locationId: 'gaia',
      });

      expect(res.status).toBe('APPROVED');
      expect(res.kiosk.id).toBe('k1');
      // Only the last 4 leaves the approval path.
      expect(res.kiosk).toHaveProperty('deviceKeyLast4');
      expect(res.kiosk).not.toHaveProperty('deviceKey');
      expect(res.kiosk.deviceKeyLast4).toHaveLength(4);
      // A real random key was generated (48 hex chars).
      const generatedKey = prisma.kiosk.create.mock.calls[0][0].data.deviceKey;
      expect(generatedKey).toMatch(/^[0-9a-f]{48}$/);
      // Audit written, without the key or the plaintext code.
      const auditArg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(auditArg.action).toBe('KIOSK_ENROLLMENT_APPROVED');
      expect(JSON.stringify(auditArg.metadata)).not.toContain(generatedKey);
    });

    it('refuses to approve a non-pending enrollment', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'CONSUMED',
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(
        service.approve('admin-1', 'e1', { name: 'X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to approve an expired enrollment', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1),
      });
      prisma.kioskEnrollment.update.mockResolvedValue({});
      await expect(
        service.approve('admin-1', 'e1', { name: 'X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reject', () => {
    it('rejects a pending enrollment and audits it', async () => {
      prisma.kioskEnrollment.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'PENDING',
        codeLast4: 'WXYZ',
      });
      prisma.kioskEnrollment.update.mockResolvedValue({});
      const res = await service.reject('admin-1', 'e1');
      expect(res.status).toBe('REJECTED');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'KIOSK_ENROLLMENT_REJECTED' }),
        }),
      );
    });
  });
});
