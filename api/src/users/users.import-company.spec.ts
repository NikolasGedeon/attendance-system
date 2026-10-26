import * as XLSX from 'xlsx';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

/**
 * CSV/Excel user import — company resolution and row-level validation:
 *  - unknown company  -> skipped
 *  - inactive company -> skipped
 *  - EXTERNAL with no company -> skipped
 *  - EXTERNAL with an active company -> created
 */
describe('UsersService.importUsers — company handling', () => {
  let prisma: any;
  let service: UsersService;

  function xlsxBuffer(aoa: (string | number)[][]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  beforeEach(() => {
    prisma = {
      location: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      company: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', name: 'AG Agathokleous', isActive: true },
          { id: 'c2', name: 'Old Co', isActive: false },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new UsersService(
      prisma as unknown as PrismaService,
      {} as EmailService,
    );
  });

  it('creates valid rows and skips invalid company rows with clear errors', async () => {
    const buffer = xlsxBuffer([
      ['fullName', 'employeeType', 'company'],
      ['Good Internal', 'INTERNAL', ''],
      ['Ext Ok', 'EXTERNAL', 'AG Agathokleous'],
      ['Ext Unknown', 'EXTERNAL', 'Nope Ltd'],
      ['Ext None', 'EXTERNAL', ''],
      ['Ext Inactive', 'EXTERNAL', 'Old Co'],
    ]);

    const res = await service.importUsers(
      { originalname: 'users.xlsx', buffer },
      'admin1',
    );

    expect(res.created).toBe(2); // Good Internal + Ext Ok
    const errorFor = (name: string) =>
      res.results.find((r: any) => r.fullName === name)?.error ?? '';
    expect(errorFor('Ext Unknown')).toMatch(/unknown company/i);
    expect(errorFor('Ext None')).toMatch(/must be assigned to a company/i);
    expect(errorFor('Ext Inactive')).toMatch(/inactive/i);

    // The active-company external user was created with the resolved companyId.
    const created = prisma.user.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    expect(
      created.find((d: any) => d.fullName === 'Ext Ok').companyId,
    ).toBe('c1');
  });
});
