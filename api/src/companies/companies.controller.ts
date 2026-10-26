import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Company management. Reads are available to ADMIN and MANAGER (needed for
 * the user form and report filters); all mutations are ADMIN-only.
 */
@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('active') active?: string) {
    return this.companiesService.list({ search, active });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.companiesService.get(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Request() req, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(req.user.id, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(req.user.id, id, dto);
  }

  @Patch(':id/activate')
  @Roles(Role.ADMIN)
  activate(@Request() req, @Param('id') id: string) {
    return this.companiesService.setActive(req.user.id, id, true);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  deactivate(@Request() req, @Param('id') id: string) {
    return this.companiesService.setActive(req.user.id, id, false);
  }
}
