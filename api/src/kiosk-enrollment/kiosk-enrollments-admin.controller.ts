import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApproveEnrollmentDto } from './dto/approve-enrollment.dto';
import { KioskEnrollmentService } from './kiosk-enrollment.service';

/** ADMIN-only review/approval of pending kiosk enrollments. */
@Controller('admin/kiosk-enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class KioskEnrollmentsAdminController {
  constructor(private readonly service: KioskEnrollmentService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listForAdmin(status);
  }

  @Post(':id/approve')
  approve(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ApproveEnrollmentDto,
  ) {
    return this.service.approve(req.user.id, id, dto);
  }

  @Post(':id/reject')
  reject(@Request() req, @Param('id') id: string) {
    return this.service.reject(req.user.id, id);
  }
}
