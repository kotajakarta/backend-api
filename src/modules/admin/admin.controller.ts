import { Controller, Get, Post, Put, Delete, UseGuards, Inject, Request } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';

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
  createUser(@Request() req: any) {
    return this.adminService.createUser(req.body);
  }

  @Post('users/import')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  importUsers(@Request() req: any) {
    return this.adminService.importUsers(req.body);
  }

  @Put('users/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  updateUser(@Request() req: any) {
    return this.adminService.updateUser(req.params.id, req.body);
  }

  @Delete('users/:id')
  @UseGuards(AccessControlGuard)
  @RequireScope('GLOBAL')
  deleteUser(@Request() req: any) {
    return this.adminService.deleteUser(req.params.id);
  }
}
