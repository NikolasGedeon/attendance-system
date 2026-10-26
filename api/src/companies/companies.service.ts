import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

type CompanyRow = {
  id: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { users: number };
};

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(c: CompanyRow) {
    return {
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      isActive: c.isActive,
      employeeCount: c._count?.users ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** List companies with employee counts, optional search and active filter. */
  async list(params: { search?: string; active?: string } = {}) {
    const q = params.search?.trim();
    const where: Prisma.CompanyWhereInput = {
      ...(params.active === 'true'
        ? { isActive: true }
        : params.active === 'false'
          ? { isActive: false }
          : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { shortName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const companies = await this.prisma.company.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return companies.map((c) => this.toResponse(c));
  }

  async get(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!company) throw new NotFoundException('Company not found');
    return this.toResponse(company);
  }

  async create(actorUserId: string | null, dto: CreateCompanyDto) {
    try {
      const company = await this.prisma.company.create({
        data: {
          name: dto.name.trim(),
          shortName: dto.shortName?.trim() || null,
        },
        include: { _count: { select: { users: true } } },
      });
      await this.audit(actorUserId, 'COMPANY_CREATED', company.id, {
        name: company.name,
      });
      return this.toResponse(company);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('A company with this name already exists');
      }
      throw error;
    }
  }

  async update(actorUserId: string | null, id: string, dto: UpdateCompanyDto) {
    const existing = await this.prisma.company.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Company not found');
    try {
      const company = await this.prisma.company.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.shortName !== undefined
            ? { shortName: dto.shortName?.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: { _count: { select: { users: true } } },
      });
      await this.audit(actorUserId, 'COMPANY_UPDATED', id, {
        changed: Object.keys(dto),
      });
      return this.toResponse(company);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('A company with this name already exists');
      }
      throw error;
    }
  }

  /**
   * Activate/deactivate. We never HARD-delete a company: users and attendance
   * records may reference it. Deactivating hides it from new assignments while
   * keeping all history intact.
   */
  async setActive(actorUserId: string | null, id: string, isActive: boolean) {
    const existing = await this.prisma.company.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Company not found');
    const company = await this.prisma.company.update({
      where: { id },
      data: { isActive },
      include: { _count: { select: { users: true } } },
    });
    await this.audit(
      actorUserId,
      isActive ? 'COMPANY_ACTIVATED' : 'COMPANY_DEACTIVATED',
      id,
    );
    return this.toResponse(company);
  }

  private async audit(
    actorUserId: string | null,
    action: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'Company',
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
