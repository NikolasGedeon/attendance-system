import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLocations() {
    return this.prisma.location.findMany({
      orderBy: {
        name: 'asc',
      },
      include: {
        users: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
  }

  async createLocation(data: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
  }) {
    if (!data.name || data.name.trim().length < 2) {
      throw new BadRequestException('Location name is required');
    }

    if (data.latitude === undefined || data.longitude === undefined) {
      throw new BadRequestException('Latitude and longitude are required');
    }

    return this.prisma.location.create({
      data: {
        name: data.name.trim(),
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        radiusMeters: data.radiusMeters ?? 150,
      },
    });
  }

  async updateLocation(
    id: string,
    data: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      isActive?: boolean;
    },
  ) {
    const location = await this.prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return this.prisma.location.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.latitude !== undefined && {
          latitude: Number(data.latitude),
        }),
        ...(data.longitude !== undefined && {
          longitude: Number(data.longitude),
        }),
        ...(data.radiusMeters !== undefined && {
          radiusMeters: Number(data.radiusMeters),
        }),
        ...(data.isActive !== undefined && {
          isActive: data.isActive,
        }),
      },
    });
  }

  async deleteLocation(id: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
    });

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return this.prisma.location.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }

  async assignUserLocation(userId: string, locationId: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (locationId) {
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

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        locationId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        location: true,
      },
    });
  }

  async getUserLocation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        location: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}