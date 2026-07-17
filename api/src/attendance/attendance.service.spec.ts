import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async clockIn(
    userId: string,
    latitude?: number,
    longitude?: number,
  ) {
    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
    });

    if (openAttendance) {
      throw new BadRequestException('You are already clocked in');
    }

    return this.prisma.attendance.create({
      data: {
        userId,
        clockIn: new Date(),
        latitude,
        longitude,
      },
    });
  }

  async clockOut(userId: string) {
    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openAttendance) {
      throw new NotFoundException('No active clock-in record found');
    }

    return this.prisma.attendance.update({
      where: {
        id: openAttendance.id,
      },
      data: {
        clockOut: new Date(),
      },
    });
  }

  async getMyAttendance(userId: string) {
    return this.prisma.attendance.findMany({
      where: {
        userId,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });
  }
}