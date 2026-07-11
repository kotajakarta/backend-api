import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class SarprasService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Scope check helper
  private checkScope(user: any, cabangId: string) {
    if (user.scope === 'CABANG' && user.cabangId !== cabangId) {
      throw new ForbiddenException('Akses ditolak: Cabang tidak sesuai scope Anda.');
    }
  }

  // === RUANG CRUD ===
  async getRuang(user: any) {
    let whereClause: any = {};
    if (user.scope === 'WILAYAH') {
      whereClause = { cabang: { wilayahId: user.wilayahId } };
    } else if (user.scope === 'CABANG') {
      whereClause = { cabangId: user.cabangId };
    }
    return this.prisma.ruang.findMany({
      where: whereClause,
      include: {
        cabang: { select: { id: true, name: true } },
      },
      orderBy: { nama: 'asc' },
    });
  }

  async getRuangById(id: string, user: any) {
    const ruang = await this.prisma.ruang.findUnique({
      where: { id },
      include: {
        cabang: { select: { id: true, name: true } },
      },
    });
    if (!ruang) return null;
    this.checkScope(user, ruang.cabangId);
    return ruang;
  }

  async createRuang(data: any, user: any) {
    const cabangId = user.scope === 'CABANG' ? user.cabangId : data.cabangId;
    if (!cabangId) throw new Error('cabangId wajib diisi.');
    this.checkScope(user, cabangId);

    return this.prisma.ruang.create({
      data: {
        nama: data.nama,
        kode: data.kode || null,
        tipe: data.tipe,
        kapasitas: data.kapasitas ? parseInt(data.kapasitas) : null,
        luas: data.luas ? parseFloat(data.luas) : null,
        kondisi: data.kondisi,
        keterangan: data.keterangan || null,
        cabangId,
      },
      include: {
        cabang: { select: { id: true, name: true } },
      },
    });
  }

  async updateRuang(id: string, data: any, user: any) {
    const ruang = await this.prisma.ruang.findUnique({ where: { id } });
    if (!ruang) throw new Error('Ruang tidak ditemukan.');
    this.checkScope(user, ruang.cabangId);

    const cabangId = user.scope === 'CABANG' ? user.cabangId : data.cabangId || ruang.cabangId;
    this.checkScope(user, cabangId);

    return this.prisma.ruang.update({
      where: { id },
      data: {
        nama: data.nama,
        kode: data.kode || null,
        tipe: data.tipe,
        kapasitas: data.kapasitas !== undefined ? (data.kapasitas ? parseInt(data.kapasitas) : null) : ruang.kapasitas,
        luas: data.luas !== undefined ? (data.luas ? parseFloat(data.luas) : null) : ruang.luas,
        kondisi: data.kondisi || ruang.kondisi,
        keterangan: data.keterangan !== undefined ? data.keterangan : ruang.keterangan,
        cabangId,
      },
      include: {
        cabang: { select: { id: true, name: true } },
      },
    });
  }

  async deleteRuang(id: string, user: any) {
    const ruang = await this.prisma.ruang.findUnique({ where: { id } });
    if (!ruang) throw new Error('Ruang tidak ditemukan.');
    this.checkScope(user, ruang.cabangId);

    return this.prisma.ruang.delete({
      where: { id },
    });
  }

  // === FASILITAS CRUD ===
  async getFasilitas(user: any) {
    let whereClause: any = {};
    if (user.scope === 'WILAYAH') {
      whereClause = { cabang: { wilayahId: user.wilayahId } };
    } else if (user.scope === 'CABANG') {
      whereClause = { cabangId: user.cabangId };
    }
    return this.prisma.fasilitas.findMany({
      where: whereClause,
      include: {
        cabang: { select: { id: true, name: true } },
        ruang: { select: { id: true, nama: true } },
      },
      orderBy: { nama: 'asc' },
    });
  }

  async getFasilitasById(id: string, user: any) {
    const fasilitas = await this.prisma.fasilitas.findUnique({
      where: { id },
      include: {
        cabang: { select: { id: true, name: true } },
        ruang: { select: { id: true, nama: true } },
      },
    });
    if (!fasilitas) return null;
    this.checkScope(user, fasilitas.cabangId);
    return fasilitas;
  }

  async createFasilitas(data: any, user: any) {
    const cabangId = user.scope === 'CABANG' ? user.cabangId : data.cabangId;
    if (!cabangId) throw new Error('cabangId wajib diisi.');
    this.checkScope(user, cabangId);

    const ruangId = data.ruangId || null;
    if (ruangId) {
      const ruang = await this.prisma.ruang.findUnique({ where: { id: ruangId } });
      if (!ruang || ruang.cabangId !== cabangId) {
        throw new Error('Ruang tidak valid atau di cabang yang berbeda.');
      }
    }

    return this.prisma.fasilitas.create({
      data: {
        nama: data.nama,
        kode: data.kode || null,
        jumlah: data.jumlah ? parseInt(data.jumlah) : 1,
        kondisi: data.kondisi,
        keterangan: data.keterangan || null,
        cabangId,
        ruangId,
      },
      include: {
        cabang: { select: { id: true, name: true } },
        ruang: { select: { id: true, nama: true } },
      },
    });
  }

  async updateFasilitas(id: string, data: any, user: any) {
    const fasilitas = await this.prisma.fasilitas.findUnique({ where: { id } });
    if (!fasilitas) throw new Error('Fasilitas tidak ditemukan.');
    this.checkScope(user, fasilitas.cabangId);

    const cabangId = user.scope === 'CABANG' ? user.cabangId : data.cabangId || fasilitas.cabangId;
    this.checkScope(user, cabangId);

    const ruangId = data.ruangId === undefined ? fasilitas.ruangId : data.ruangId || null;
    if (ruangId) {
      const ruang = await this.prisma.ruang.findUnique({ where: { id: ruangId } });
      if (!ruang || ruang.cabangId !== cabangId) {
        throw new Error('Ruang tidak valid atau di cabang yang berbeda.');
      }
    }

    return this.prisma.fasilitas.update({
      where: { id },
      data: {
        nama: data.nama || fasilitas.nama,
        kode: data.kode !== undefined ? data.kode : fasilitas.kode,
        jumlah: data.jumlah !== undefined ? parseInt(data.jumlah) : fasilitas.jumlah,
        kondisi: data.kondisi || fasilitas.kondisi,
        keterangan: data.keterangan !== undefined ? data.keterangan : fasilitas.keterangan,
        cabangId,
        ruangId,
      },
      include: {
        cabang: { select: { id: true, name: true } },
        ruang: { select: { id: true, nama: true } },
      },
    });
  }

  async deleteFasilitas(id: string, user: any) {
    const fasilitas = await this.prisma.fasilitas.findUnique({ where: { id } });
    if (!fasilitas) throw new Error('Fasilitas tidak ditemukan.');
    this.checkScope(user, fasilitas.cabangId);

    return this.prisma.fasilitas.delete({
      where: { id },
    });
  }
}
