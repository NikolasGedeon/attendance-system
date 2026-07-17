import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LocationsService } from './locations.service';

@Controller('locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  getLocations() {
    return this.locationsService.getLocations();
  }

  @Post()
  createLocation(
    @Body()
    body: {
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters?: number;
    },
  ) {
    return this.locationsService.createLocation(body);
  }

  @Patch(':id')
  updateLocation(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      isActive?: boolean;
    },
  ) {
    return this.locationsService.updateLocation(id, body);
  }

  @Delete(':id')
  deleteLocation(@Param('id') id: string) {
    return this.locationsService.deleteLocation(id);
  }

  @Patch('users/:userId')
  assignUserLocation(
    @Param('userId') userId: string,
    @Body() body: { locationId: string | null },
  ) {
    return this.locationsService.assignUserLocation(userId, body.locationId);
  }

  @Get('users/:userId')
  getUserLocation(@Param('userId') userId: string) {
    return this.locationsService.getUserLocation(userId);
  }
}