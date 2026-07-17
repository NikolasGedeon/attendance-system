import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPositions() {
    return this.prisma.position.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async createPosition(name: string) {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 2) {
      throw new BadRequestException('Position name is required');
    }

    const existing = await this.prisma.position.findUnique({
      where: { name: trimmed },
    });
    if (existing) {
      throw new ConflictException('Position already exists');
    }

    return this.prisma.position.create({
      data: { name: trimmed },
    });
  }

  async updatePosition(
    id: string,
    data: { name?: string; isActive?: boolean },
  ) {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    const trimmed = data.name?.trim();
    if (trimmed !== undefined && trimmed.length < 2) {
      throw new BadRequestException('Position name is too short');
    }

    if (trimmed && trimmed !== position.name) {
      const existing = await this.prisma.position.findUnique({
        where: { name: trimmed },
      });
      if (existing) {
        throw new ConflictException('Position already exists');
      }
    }

    return this.prisma.position.update({
      where: { id },
      data: {
        ...(trimmed !== undefined && { name: trimmed }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  /// Soft delete: deactivates the position; assigned users keep it
  /// but it can no longer be selected for new assignments.
  async deactivatePosition(id: string) {
    const position = await this.prisma.position.findUnique({ where: { id } });
    if (!position) {
      throw new NotFoundException('Position not found');
    }

    return this.prisma.position.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
