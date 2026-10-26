import { BadRequestException } from '@nestjs/common';
import { EmployeeType, Role } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

/**
 * Company assignment rules on user create/update:
 *  - EXTERNAL users must have a company (server-side).
 *  - Switching to INTERNAL preserves the existing company (not cleared).
 */
describe('UsersService — company assignment rules', () => {
  let prisma: any;
  let email: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
      company: { findUnique: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    email = {} as EmailService;
    service = new UsersService(
      prisma as unknown as PrismaService,
      email as EmailService,
    );
  });

  it('rejects creating an EXTERNAL user with no company', async () => {
    await expect(
      service.createUser({
        fullName: 'Ext Person',
        employeeType: EmployeeType.EXTERNAL,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('stamps companyId when creating an EXTERNAL user with an active company', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: 'c1', isActive: true });
    await service.createUser({
      fullName: 'Ext Person',
      employeeType: EmployeeType.EXTERNAL,
      companyId: 'c1',
    } as any);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'c1' }),
      }),
    );
  });

  it('rejects assigning an INACTIVE company to a new user', async () => {
    prisma.company.findUnique.mockResolvedValue({ id: 'c1', isActive: false });
    await expect(
      service.createUser({
        fullName: 'X',
        employeeType: EmployeeType.EXTERNAL,
        companyId: 'c1',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves the company when switching a user back to INTERNAL', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: null,
      employeeType: EmployeeType.EXTERNAL,
      companyId: 'c1',
      role: Role.EMPLOYEE,
    });
    await service.updateUser('u1', { employeeType: EmployeeType.INTERNAL });
    // No companyId key in the update payload => company is untouched/preserved.
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('companyId');
    expect(data.employeeType).toBe(EmployeeType.INTERNAL);
  });

  it('rejects switching a user to EXTERNAL when they have no company', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: null,
      employeeType: EmployeeType.INTERNAL,
      companyId: null,
      role: Role.EMPLOYEE,
    });
    await expect(
      service.updateUser('u1', { employeeType: EmployeeType.EXTERNAL }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
