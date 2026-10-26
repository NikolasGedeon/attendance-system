import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  let prisma: any;
  let service: CompaniesService;

  const row = (over: Partial<any> = {}) => ({
    id: 'c1',
    name: 'AG Agathokleous',
    shortName: 'AG',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { users: 8 },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      company: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new CompaniesService(prisma as unknown as PrismaService);
  });

  it('list maps employeeCount from _count.users', async () => {
    prisma.company.findMany.mockResolvedValue([row()]);
    const res = await service.list();
    expect(res[0].employeeCount).toBe(8);
    expect(res[0].name).toBe('AG Agathokleous');
  });

  it('list applies the active filter', async () => {
    prisma.company.findMany.mockResolvedValue([]);
    await service.list({ active: 'true' });
    expect(prisma.company.findMany.mock.calls[0][0].where).toMatchObject({
      isActive: true,
    });
  });

  it('create rejects a duplicate name (P2002)', async () => {
    prisma.company.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.create('admin1', { name: 'AG Agathokleous' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivate flips isActive without deleting', async () => {
    prisma.company.findUnique.mockResolvedValue(row());
    prisma.company.update.mockResolvedValue(row({ isActive: false }));
    const res = await service.setActive('admin1', 'c1', false);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(res.isActive).toBe(false);
  });

  it('get throws NotFound for a missing company', async () => {
    prisma.company.findUnique.mockResolvedValue(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
