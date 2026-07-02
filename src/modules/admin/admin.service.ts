import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getUsers() {
    return this.prisma.user.findMany({
      include: {
        wilayah: true,
        cabang: true
      }
    });
  }

  async createUser(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        scope: data.scope,
        divisi: data.divisi,
        wilayahId: data.wilayahId || null,
        cabangId: data.cabangId || null
      }
    });
  }

  async updateUser(id: string, data: any) {
    const updateData: any = {
      username: data.username,
      scope: data.scope,
      divisi: data.divisi,
      wilayahId: data.wilayahId || null,
      cabangId: data.cabangId || null
    };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData
    });
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({
      where: { id }
    });
  }

  async getWilayah() {
    return this.prisma.wilayah.findMany({
      include: { cabangs: true }
    });
  }
}
