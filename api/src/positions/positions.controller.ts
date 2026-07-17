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
import { PositionsService } from './positions.service';

@Controller('positions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get()
  getPositions() {
    return this.positionsService.getPositions();
  }

  @Post()
  createPosition(@Body() body: { name: string }) {
    return this.positionsService.createPosition(body.name);
  }

  @Patch(':id')
  updatePosition(
    @Param('id') id: string,
    @Body() body: { name?: string; isActive?: boolean },
  ) {
    return this.positionsService.updatePosition(id, body);
  }

  @Delete(':id')
  deactivatePosition(@Param('id') id: string) {
    return this.positionsService.deactivatePosition(id);
  }
}
