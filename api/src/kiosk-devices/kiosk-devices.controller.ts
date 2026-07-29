import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssignKioskLocationDto } from './assign-location.dto';
import { CreateKioskDeviceDto } from './dto/create-kiosk-device.dto';
import { UpdateKioskDeviceDto } from './dto/update-kiosk-device.dto';
import { KioskDevicesService } from './kiosk-devices.service';

/** ADMIN-only kiosk device management. */
@Controller('admin/kiosk-devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class KioskDevicesController {
  constructor(private readonly service: KioskDevicesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Request() req, @Body() dto: CreateKioskDeviceDto) {
    return this.service.create(req.user.id, dto);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateKioskDeviceDto,
  ) {
    return this.service.update(req.user.id, id, dto);
  }

  @Patch(':id/activate')
  activate(@Request() req, @Param('id') id: string) {
    return this.service.setActive(req.user.id, id, true);
  }

  @Patch(':id/deactivate')
  deactivate(@Request() req, @Param('id') id: string) {
    return this.service.setActive(req.user.id, id, false);
  }

  @Patch(':id/location')
  assignLocation(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: AssignKioskLocationDto,
  ) {
    return this.service.assignLocation(req.user.id, id, dto.locationId);
  }
}
