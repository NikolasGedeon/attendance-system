import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthMethod, EmployeeType, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// Every users response uses this select: no passwordHash, location included.
const userSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  employeeCode: true,
  department: true,
  phoneNumber: true,
  cardUid: true,
  requireOtpForCard: true,
  hasMobile: true,
  employeeType: true,
  positionId: true,
  position: true,
  locationId: true,
  location: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ImportRowResult {
  row: number;
  fullName: string;
  status: 'created' | 'skipped';
  error?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsers(status?: string) {
    const normalized = (status || 'all').toLowerCase();
    const where =
      normalized === 'active'
        ? { isActive: true }
        : normalized === 'inactive'
          ? { isActive: false }
          : {};

    return this.prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: userSelect,
    });
  }

  /**
   * Soft delete: deactivates the user (isActive=false, card disabled).
   * Attendance history is always preserved; nothing is hard-deleted.
   */
  async deactivateUser(id: string, actorUserId: string | null) {
    if (actorUserId && id === actorUserId) {
      throw new BadRequestException(
        'You cannot deactivate your own account.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const attendanceCount = await this.prisma.attendance.count({
      where: { userId: id },
    });

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        cardDisabledAt: new Date(),
      },
      select: userSelect,
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'USER_DEACTIVATED',
        entityType: 'User',
        entityId: id,
        metadata: { attendanceCount },
      },
    });

    return {
      success: true,
      deactivated: true,
      hadAttendance: attendanceCount > 0,
      message:
        attendanceCount > 0
          ? 'User has attendance history and was deactivated instead of deleted.'
          : 'User was deactivated.',
      user: updated,
    };
  }

  /**
   * PERMANENT delete: removes the user and, via cascade, all their
   * attendance records, adjustment logs on those records, devices, OTPs
   * and mobile tokens. Prior audit-log references to the user are
   * anonymized. Irreversible.
   *
   * Blocked when the user has authored attendance adjustments for OTHER
   * users (the adjustment log requires a valid changedBy reference).
   */
  async permanentlyDeleteUser(id: string, actorUserId: string | null) {
    if (actorUserId && id === actorUserId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const authoredAdjustments =
      await this.prisma.attendanceAdjustmentLog.count({
        where: {
          changedById: id,
          attendance: { userId: { not: id } },
        },
      });
    if (authoredAdjustments > 0) {
      throw new BadRequestException(
        'This user has made attendance adjustments for other users and ' +
          'cannot be permanently deleted. Deactivate the user instead.',
      );
    }

    const attendanceCount = await this.prisma.attendance.count({
      where: { userId: id },
    });

    await this.prisma.$transaction(async (tx) => {
      // Adjustment logs authored by this user on their own attendance
      // are removed with the attendance cascade, but delete explicitly
      // first to satisfy the changedBy restriction.
      await tx.attendanceAdjustmentLog.deleteMany({
        where: { changedById: id },
      });
      // Anonymize previous audit-log references (no FK, plain string).
      await tx.auditLog.updateMany({
        where: { actorUserId: id },
        data: { actorUserId: null },
      });
      // Cascades: attendances (+ their adjustment logs), devices,
      // OTPs, mobile tokens.
      await tx.user.delete({ where: { id } });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'USER_PERMANENTLY_DELETED',
        entityType: 'User',
        entityId: id,
        metadata: { attendanceCount },
      },
    });

    return {
      success: true,
      deleted: true,
      message:
        'User permanently deleted, including all attendance history.',
    };
  }

  /**
   * Batch delete. permanent=false (default) deactivates;
   * permanent=true removes users and their history completely.
   * Reports per-user failures instead of aborting.
   */
  async batchDeactivateUsers(
    userIds: string[],
    actorUserId: string | null,
    permanent = false,
  ) {
    const uniqueIds = [...new Set(userIds)];
    const failedUsers: Array<{ userId: string; reason: string }> = [];
    let processedCount = 0;

    for (const id of uniqueIds) {
      if (actorUserId && id === actorUserId) {
        failedUsers.push({
          userId: id,
          reason: permanent
            ? 'You cannot delete your own account.'
            : 'You cannot deactivate your own account.',
        });
        continue;
      }

      if (permanent) {
        try {
          await this.permanentlyDeleteUser(id, actorUserId);
          processedCount++;
        } catch (error) {
          failedUsers.push({
            userId: id,
            reason:
              error instanceof Error ? error.message : 'Delete failed',
          });
        }
        continue;
      }

      const user = await this.prisma.user.findUnique({ where: { id } });
      if (!user) {
        failedUsers.push({ userId: id, reason: 'User not found' });
        continue;
      }

      await this.prisma.user.update({
        where: { id },
        data: { isActive: false, cardDisabledAt: new Date() },
      });
      processedCount++;
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: permanent
          ? 'USERS_BATCH_PERMANENTLY_DELETED'
          : 'USERS_BATCH_DEACTIVATED',
        entityType: 'User',
        metadata: {
          totalRequested: uniqueIds.length,
          processedCount,
          failedCount: failedUsers.length,
        },
      },
    });

    return {
      success: true,
      permanent,
      totalRequested: uniqueIds.length,
      deactivatedCount: permanent ? 0 : processedCount,
      deletedCount: permanent ? processedCount : 0,
      failedCount: failedUsers.length,
      failedUsers,
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createUser(dto: CreateUserDto) {
    const fullName = dto.fullName.trim();
    const email = dto.email?.trim() || null;
    const employeeCode = dto.employeeCode?.trim() || null;
    const cardUid = dto.cardUid?.trim() || null;
    const phoneNumber = dto.phoneNumber?.trim() || null;
    const department = dto.department?.trim() || null;

    if (dto.password && !email) {
      throw new BadRequestException('A password requires an email address');
    }

    await this.assertUniqueFields({ email, employeeCode, cardUid });

    if (dto.locationId !== undefined) {
      await this.validateLocation(dto.locationId);
    }

    if (dto.positionId !== undefined) {
      await this.validatePosition(dto.positionId);
    }

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    return this.prisma.user.create({
      data: {
        fullName,
        email,
        passwordHash,
        role: dto.role ?? Role.EMPLOYEE,
        isActive: dto.isActive ?? true,
        employeeCode,
        department,
        phoneNumber,
        cardUid,
        cardAssignedAt: cardUid ? new Date() : null,
        requireOtpForCard: dto.requireOtpForCard ?? false,
        hasMobile: dto.hasMobile ?? false,
        employeeType: dto.employeeType ?? EmployeeType.INTERNAL,
        positionId: dto.positionId ?? null,
        locationId: dto.locationId ?? null,
      },
      select: userSelect,
    });
  }

  /**
   * Imports users from a CSV or Excel file buffer.
   * Expected columns (case-insensitive, flexible spacing):
   * fullName (required), email, phoneNumber, employeeCode, department,
   * role, cardUid, location (location name), requireOtpForCard.
   * Rows with problems are skipped and reported; valid rows are created.
   */
  /**
   * Builds the user import template workbook:
   * - "Users" sheet with the expected columns and two example rows
   * - "Reference" sheet with the allowed values (roles, types, auth
   *   methods, and the actual positions/locations from the database)
   */
  async buildUserTemplateWorkbook(): Promise<ExcelJS.Workbook> {
    const positions = await this.prisma.position.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const locations = await this.prisma.location.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const header = [
      'fullName',
      'email',
      'employeeCode',
      'phoneNumber',
      'cardUid',
      'employeeType',
      'position',
      'department',
      'locationName',
      'role',
      'isActive',
      'requireOtpForCard',
      'hasMobile',
      'authMethod',
    ];

    const examplePosition = positions[0]?.name ?? 'Security Guard';
    const exampleLocation = locations[0]?.name ?? 'GAIA';

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attendance System';
    wb.created = new Date();

    // ----- Users sheet -----
    const users = wb.addWorksheet('Users', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headerRow = users.addRow(header);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF888888' } },
      };
      cell.alignment = { vertical: 'middle' };
    });
    users.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header.length },
    };

    const exampleRows = [
      [
        'Maria Ioannou (EXAMPLE - delete this row)',
        'maria@example.com',
        'EMP010',
        '+35799111222',
        'CARD010',
        'INTERNAL',
        examplePosition,
        'Operations',
        exampleLocation,
        'EMPLOYEE',
        'true',
        'false',
        'false',
        'CARD',
      ],
      [
        'Andreas Georgiou (EXAMPLE - delete this row)',
        '',
        'EMP011',
        '99333444',
        'CARD011',
        'EXTERNAL',
        examplePosition,
        'Operations',
        exampleLocation,
        'EMPLOYEE',
        'true',
        'true',
        'false',
        'CARD',
      ],
    ];
    for (const rowValues of exampleRows) {
      const row = users.addRow(rowValues);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { italic: true, color: { argb: 'FF808080' } };
      });
    }
    users.columns.forEach((col, i) => {
      col.width = Math.max(16, header[i].length + 6);
    });
    users.getColumn(1).width = 38;

    // ----- Instructions sheet -----
    const instructions = wb.addWorksheet('Instructions');
    const lines: Array<[string, string]> = [
      ['How to use this template', ''],
      ['1.', 'Fill one row per user in the "Users" sheet.'],
      ['2.', 'Delete the grey EXAMPLE rows before importing.'],
      ['3.', 'Only fullName is required; other columns are optional.'],
      ['4.', 'Upload the file in Admin > Users > Import.'],
      ['', ''],
      ['Required columns', 'fullName (min 2 characters)'],
      [
        'Phone number format',
        'Cyprus mobile: 99123456, +35799123456 or 0035799123456',
      ],
      ['Card UID format', 'The UID printed/encoded on the RFID/NFC card. Must be unique.'],
      ['Duplicates', 'email, employeeCode and cardUid must not already exist.'],
      [
        'position / locationName',
        'Must match an existing name from the Reference sheet exactly (case-insensitive).',
      ],
    ];
    for (const [a, b] of lines) {
      instructions.addRow([a, b]);
    }
    instructions.getRow(1).font = { bold: true, size: 14 };
    instructions.getColumn(1).width = 24;
    instructions.getColumn(2).width = 90;

    // ----- Reference sheet -----
    const reference = wb.addWorksheet('Reference', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const refHeader = reference.addRow(['Column', 'Allowed values / notes']);
    refHeader.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };
    });
    const referenceRows: string[][] = [
      ['fullName', 'Required. At least 2 characters.'],
      ['email', 'Optional. Must be unique. Leave empty for card-only users.'],
      ['employeeCode', 'Optional. Must be unique.'],
      ['phoneNumber', 'Optional. Cyprus mobile for SMS OTP, e.g. 99123456.'],
      ['cardUid', 'Optional. Must be unique.'],
      ['employeeType', 'INTERNAL or EXTERNAL (default INTERNAL)'],
      ['position', positions.map((p) => p.name).join(', ') || '(none yet)'],
      ['department', 'Free text.'],
      ['locationName', locations.map((l) => l.name).join(', ') || '(none yet)'],
      ['role', 'ADMIN, MANAGER or EMPLOYEE (default EMPLOYEE)'],
      ['isActive', 'true or false (default true)'],
      ['requireOtpForCard', 'true or false (default false)'],
      ['hasMobile', 'true or false (default false)'],
      ['authMethod', 'CARD, MOBILE_QR or MANUAL (default CARD)'],
    ];
    for (const row of referenceRows) {
      reference.addRow(row);
    }
    reference.getColumn(1).width = 22;
    reference.getColumn(2).width = 90;

    return wb;
  }

  async importUsers(
    file: { originalname: string; buffer: Buffer } | undefined,
    actorUserId: string | null,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded (field name: "file")');
    }

    const name = file.originalname.toLowerCase();
    if (
      !name.endsWith('.csv') &&
      !name.endsWith('.xlsx') &&
      !name.endsWith('.xls')
    ) {
      throw new BadRequestException(
        'Unsupported file type. Upload a .csv or .xlsx file.',
      );
    }

    let rows: Record<string, unknown>[];
    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('No sheet found');
      }
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: '',
      });
    } catch {
      throw new BadRequestException(
        'Could not read the file. Make sure it is a valid CSV or Excel file.',
      );
    }

    if (rows.length === 0) {
      throw new BadRequestException('The file contains no data rows');
    }

    // Preload locations and positions (by lowercase name)
    // and existing unique fields.
    const locations = await this.prisma.location.findMany();
    const locationByName = new Map(
      locations.map((l) => [l.name.trim().toLowerCase(), l]),
    );
    const positions = await this.prisma.position.findMany();
    const positionByName = new Map(
      positions.map((p) => [p.name.trim().toLowerCase(), p]),
    );

    const existing = await this.prisma.user.findMany({
      select: { email: true, employeeCode: true, cardUid: true },
    });
    const usedEmails = new Set(
      existing.map((u) => u.email?.toLowerCase()).filter(Boolean),
    );
    const usedCodes = new Set(
      existing.map((u) => u.employeeCode?.toLowerCase()).filter(Boolean),
    );
    const usedCards = new Set(
      existing.map((u) => u.cardUid?.toLowerCase()).filter(Boolean),
    );

    const validRoles = new Set(Object.values(Role) as string[]);
    const results: ImportRowResult[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // header is row 1
      const raw = this.normalizeRowKeys(rows[i]);

      const fullName = String(raw.fullname ?? '').trim();
      const email = String(raw.email ?? '').trim() || null;
      const phoneNumber = String(raw.phonenumber ?? '').trim() || null;
      const employeeCode = String(raw.employeecode ?? '').trim() || null;
      const department = String(raw.department ?? '').trim() || null;
      const cardUid = String(raw.carduid ?? '').trim() || null;
      const locationName = String(raw.location ?? '').trim() || null;
      const positionName = String(raw.position ?? '').trim() || null;
      const employeeTypeRaw = String(raw.employeetype ?? '')
        .trim()
        .toUpperCase();
      const roleRaw = String(raw.role ?? '').trim().toUpperCase();
      const requireOtpRaw = String(raw.requireotpforcard ?? '')
        .trim()
        .toLowerCase();
      const isActiveRaw = String(raw.isactive ?? '').trim().toLowerCase();
      const hasMobileRaw = String(raw.hasmobile ?? '').trim().toLowerCase();
      const authMethodRaw = String(raw.authmethod ?? '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]/g, '_');

      const skip = (error: string) => {
        results.push({ row: rowNumber, fullName, status: 'skipped', error });
      };

      if (!fullName || fullName.length < 2) {
        skip('fullName is required');
        continue;
      }
      if (email && !email.includes('@')) {
        skip(`Invalid email: ${email}`);
        continue;
      }
      if (roleRaw && !validRoles.has(roleRaw)) {
        skip(`Invalid role: ${roleRaw} (use ADMIN, MANAGER or EMPLOYEE)`);
        continue;
      }
      if (
        employeeTypeRaw &&
        employeeTypeRaw !== 'INTERNAL' &&
        employeeTypeRaw !== 'EXTERNAL'
      ) {
        skip(
          `Invalid employeeType: ${employeeTypeRaw} (use INTERNAL or EXTERNAL)`,
        );
        continue;
      }
      if (
        authMethodRaw &&
        !(Object.values(AuthMethod) as string[]).includes(authMethodRaw)
      ) {
        skip(
          `Invalid authMethod: ${authMethodRaw} (use CARD, MOBILE_QR or MANUAL)`,
        );
        continue;
      }
      if (email && usedEmails.has(email.toLowerCase())) {
        skip(`Email already exists: ${email}`);
        continue;
      }
      if (employeeCode && usedCodes.has(employeeCode.toLowerCase())) {
        skip(`Employee code already exists: ${employeeCode}`);
        continue;
      }
      if (cardUid && usedCards.has(cardUid.toLowerCase())) {
        skip(`Card UID already exists: ${cardUid}`);
        continue;
      }

      let locationId: string | null = null;
      if (locationName) {
        const location = locationByName.get(locationName.toLowerCase());
        if (!location) {
          skip(`Unknown location: ${locationName}`);
          continue;
        }
        if (!location.isActive) {
          skip(`Location is inactive: ${locationName}`);
          continue;
        }
        locationId = location.id;
      }

      let positionId: string | null = null;
      if (positionName) {
        const position = positionByName.get(positionName.toLowerCase());
        if (!position) {
          skip(`Unknown position: ${positionName}`);
          continue;
        }
        if (!position.isActive) {
          skip(`Position is inactive: ${positionName}`);
          continue;
        }
        positionId = position.id;
      }

      try {
        await this.prisma.user.create({
          data: {
            fullName,
            email,
            role: roleRaw ? (roleRaw as Role) : Role.EMPLOYEE,
            employeeCode,
            department,
            phoneNumber,
            cardUid,
            cardAssignedAt: cardUid ? new Date() : null,
            requireOtpForCard: ['true', 'yes', '1'].includes(requireOtpRaw),
            isActive: isActiveRaw
              ? ['true', 'yes', '1'].includes(isActiveRaw)
              : true,
            hasMobile: ['true', 'yes', '1'].includes(hasMobileRaw),
            authMethod: authMethodRaw
              ? (authMethodRaw as AuthMethod)
              : AuthMethod.CARD,
            employeeType:
              employeeTypeRaw === 'EXTERNAL'
                ? EmployeeType.EXTERNAL
                : EmployeeType.INTERNAL,
            positionId,
            locationId,
          },
        });
      } catch {
        skip('Database rejected this row (duplicate value?)');
        continue;
      }

      // Reserve the unique values so later rows in the same file
      // cannot reuse them.
      if (email) usedEmails.add(email.toLowerCase());
      if (employeeCode) usedCodes.add(employeeCode.toLowerCase());
      if (cardUid) usedCards.add(cardUid.toLowerCase());

      created++;
      results.push({ row: rowNumber, fullName, status: 'created' });
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'USERS_IMPORTED',
        entityType: 'User',
        metadata: {
          fileName: file.originalname,
          total: rows.length,
          created,
          skipped: rows.length - created,
        },
      },
    });

    return {
      success: true,
      total: rows.length,
      created,
      skipped: rows.length - created,
      results,
    };
  }

  async updateUser(id: string, data: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      data.email !== undefined &&
      data.email !== null &&
      data.email !== user.email
    ) {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) {
        throw new ConflictException('Email is already in use');
      }
    }

    // Empty string clears these optional text fields.
    const employeeCode =
      data.employeeCode !== undefined
        ? data.employeeCode.trim() || null
        : undefined;
    const cardUid =
      data.cardUid !== undefined ? data.cardUid.trim() || null : undefined;
    const department =
      data.department !== undefined
        ? data.department.trim() || null
        : undefined;
    const phoneNumber =
      data.phoneNumber !== undefined
        ? data.phoneNumber.trim() || null
        : undefined;

    if (
      employeeCode !== undefined &&
      employeeCode !== null &&
      employeeCode !== user.employeeCode
    ) {
      const existing = await this.prisma.user.findUnique({
        where: { employeeCode },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Employee code is already in use');
      }
    }

    if (cardUid !== undefined && cardUid !== null && cardUid !== user.cardUid) {
      const existing = await this.prisma.user.findUnique({
        where: { cardUid },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Card UID is already in use');
      }
    }

    if (data.locationId !== undefined) {
      await this.validateLocation(data.locationId);
    }

    if (data.positionId !== undefined) {
      await this.validatePosition(data.positionId);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName.trim() }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.locationId !== undefined && { locationId: data.locationId }),
        ...(data.positionId !== undefined && { positionId: data.positionId }),
        ...(data.employeeType !== undefined && {
          employeeType: data.employeeType,
        }),
        ...(employeeCode !== undefined && { employeeCode }),
        ...(department !== undefined && { department }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(cardUid !== undefined && {
          cardUid,
          // New card assigned now; cleared card resets the timestamp.
          ...(cardUid !== user.cardUid && {
            cardAssignedAt: cardUid ? new Date() : null,
          }),
        }),
        ...(data.requireOtpForCard !== undefined && {
          requireOtpForCard: data.requireOtpForCard,
        }),
        ...(data.hasMobile !== undefined && { hasMobile: data.hasMobile }),
      },
      select: userSelect,
    });
  }

  async updateUserLocation(id: string, locationId: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.validateLocation(locationId);

    return this.prisma.user.update({
      where: { id },
      data: { locationId },
      select: userSelect,
    });
  }

  /// Lowercases and strips spaces/underscores from row keys so
  /// "Full Name", "full_name" and "fullName" all map to "fullname".
  private normalizeRowKeys(row: Record<string, unknown>) {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toLowerCase().replace(/[\s_]/g, '')] = value;
    }
    // Aliases
    if (normalized.phone !== undefined && normalized.phonenumber === undefined) {
      normalized.phonenumber = normalized.phone;
    }
    if (normalized.code !== undefined && normalized.employeecode === undefined) {
      normalized.employeecode = normalized.code;
    }
    if (
      normalized.locationname !== undefined &&
      normalized.location === undefined
    ) {
      normalized.location = normalized.locationname;
    }
    if (
      normalized.requireotp !== undefined &&
      normalized.requireotpforcard === undefined
    ) {
      normalized.requireotpforcard = normalized.requireotp;
    }
    return normalized;
  }

  private async assertUniqueFields(fields: {
    email: string | null;
    employeeCode: string | null;
    cardUid: string | null;
  }) {
    if (fields.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: fields.email },
      });
      if (existing) throw new ConflictException('Email is already in use');
    }
    if (fields.employeeCode) {
      const existing = await this.prisma.user.findUnique({
        where: { employeeCode: fields.employeeCode },
      });
      if (existing) {
        throw new ConflictException('Employee code is already in use');
      }
    }
    if (fields.cardUid) {
      const existing = await this.prisma.user.findUnique({
        where: { cardUid: fields.cardUid },
      });
      if (existing) throw new ConflictException('Card UID is already in use');
    }
  }

  /// null is allowed (removes the assignment); otherwise the position
  /// must exist and be active.
  private async validatePosition(positionId: string | null) {
    if (positionId === null) return;

    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      throw new NotFoundException('Position not found');
    }

    if (!position.isActive) {
      throw new BadRequestException('Cannot assign inactive position');
    }
  }

  /// null is allowed (removes the assignment); otherwise the location
  /// must exist and be active.
  private async validateLocation(locationId: string | null) {
    if (locationId === null) return;

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    if (!location.isActive) {
      throw new BadRequestException('Cannot assign inactive location');
    }
  }
}
