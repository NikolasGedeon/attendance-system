import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BatchDeleteUsersDto } from './dto/batch-delete-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserLocationDto } from './dto/update-user-location.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** ?status=active|inactive|all (default all) */
  @Get()
  getUsers(@Query('status') status?: string) {
    return this.usersService.getUsers(status);
  }

  /**
   * Downloads the user import template (.xlsx). Includes Users,
   * Instructions and Reference sheets.
   */
  @Get('template/export')
  async exportTemplate(@Res() res: Response) {
    const wb = await this.usersService.buildUserTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="users-import-template.xlsx"',
    );
    res.send(Buffer.from(buffer));
  }

  @Get(':id')
  getUser(@Param('id') id: string) {
    return this.usersService.getUser(id);
  }

  @Post()
  createUser(@Body() body: CreateUserDto) {
    return this.usersService.createUser(body);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importUsers(
    @UploadedFile() file: { originalname: string; buffer: Buffer },
    @Request() req: { user?: { id?: string } },
  ) {
    return this.usersService.importUsers(file, req.user?.id ?? null);
  }

  /**
   * PERMANENT delete: removes the user and all their attendance history.
   * Irreversible. ADMIN only.
   */
  @Delete(':id/permanent')
  @Roles(Role.ADMIN)
  permanentlyDeleteUser(
    @Param('id') id: string,
    @Request() req: { user?: { id?: string } },
  ) {
    return this.usersService.permanentlyDeleteUser(id, req.user?.id ?? null);
  }

  /** Soft delete (deactivate). ADMIN only. */
  @Delete(':id')
  @Roles(Role.ADMIN)
  deleteUser(
    @Param('id') id: string,
    @Request() req: { user?: { id?: string } },
  ) {
    return this.usersService.deactivateUser(id, req.user?.id ?? null);
  }

  /**
   * Batch delete. body.permanent=true removes users completely;
   * otherwise deactivates. ADMIN only.
   */
  @Post('batch-delete')
  @Roles(Role.ADMIN)
  batchDeleteUsers(
    @Body() body: BatchDeleteUsersDto,
    @Request() req: { user?: { id?: string } },
  ) {
    return this.usersService.batchDeactivateUsers(
      body.userIds,
      req.user?.id ?? null,
      body.permanent ?? false,
    );
  }

  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.usersService.updateUser(id, body);
  }

  @Patch(':id/location')
  updateUserLocation(
    @Param('id') id: string,
    @Body() body: UpdateUserLocationDto,
  ) {
    return this.usersService.updateUserLocation(id, body.locationId ?? null);
  }
}
