import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Body, Param } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Controller('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Get('users')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  getUsersAndWilayah() {
    return this.adminService.getUsers();
  }

  @Post('users')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Post('users/import')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  importUsers(@Body() data: any[]) {
    return this.adminService.importUsers(data);
  }

  @Put('users/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }
}
