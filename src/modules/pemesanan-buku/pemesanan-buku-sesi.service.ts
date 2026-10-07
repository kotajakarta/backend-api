import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { labelSesi, normalizeSemester, tahunAjaranValid } from './pemesanan-buku-format.js';
import type { CreateSesiDto, UpdateSesiDto } from './dto/sesi.dto.js';

export interface SesiRow { id: string; tahunAjaran: string; semester: string; isActive: boolean; isOpen: boolean; createdAt: Date; }
export interface SesiDto { id: string; tahunAjaran: string; semester: string; label: string; isActive: boolean; isOpen: boolean; }

export const MSG_SESI_TUTUP = 'Sesi pemesanan tidak aktif atau sudah ditutup.';
const MSG_DUPLIKAT = 'Sesi untuk tahun ajaran & semester ini sudah ada.';

@Injectable()
export class PemesananBukuSesiService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  toDto(s: SesiRow): SesiDto {
    return { id: s.id, tahunAjaran: s.tahunAjaran, semester: s.semester, label: labelSesi(s), isActive: s.isActive, isOpen: s.isOpen };
  }

  async listSesi(): Promise<{ sesi: SesiDto[]; aktif: SesiDto | null }> {
    const rows = await this.prisma.sesiPemesananBuku.findMany({ orderBy: { createdAt: 'desc' } });
    const sesi = rows.map((r) => this.toDto(r));
    return { sesi, aktif: sesi.find((s) => s.isActive) ?? null };
  }

  private validasi(ta: unknown, sem: unknown) {
    if (!tahunAjaranValid(ta)) throw new BadRequestException('Format tahun ajaran harus YYYY/YYYY, contoh 2026/2027.');
    const semester = normalizeSemester(sem);
    if (!semester) throw new BadRequestException('Semester harus GANJIL atau GENAP.');
    return { tahunAjaran: ta.trim(), semester };
  }

  async createSesi(dto: CreateSesiDto): Promise<SesiDto> {
    const data = { ...this.validasi(dto.tahunAjaran, dto.semester), isActive: dto.isActive ?? false, isOpen: dto.isOpen ?? true };
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (data.isActive) await tx.sesiPemesananBuku.updateMany({ where: { isActive: true }, data: { isActive: false } });
        return tx.sesiPemesananBuku.create({ data });
      });
      return this.toDto(created);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(MSG_DUPLIKAT);
      throw e;
    }
  }

  async updateSesi(id: string, dto: UpdateSesiDto): Promise<SesiDto> {
    const existing = await this.prisma.sesiPemesananBuku.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sesi pemesanan tidak ditemukan.');
    const data: { tahunAjaran?: string; semester?: string; isActive?: boolean; isOpen?: boolean } = {};
    if (dto.tahunAjaran !== undefined || dto.semester !== undefined) {
      const v = this.validasi(dto.tahunAjaran ?? existing.tahunAjaran, dto.semester ?? existing.semester);
      if (v.tahunAjaran !== existing.tahunAjaran || v.semester !== existing.semester) {
        if ((await this.jumlahPesanan(id)) > 0) {
          throw new BadRequestException('TA/semester tidak bisa diubah karena sesi sudah memiliki pesanan.');
        }
        Object.assign(data, v);
      }
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isOpen !== undefined) data.isOpen = dto.isOpen;
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (data.isActive === true) {
          await tx.sesiPemesananBuku.updateMany({ where: { isActive: true, id: { not: id } }, data: { isActive: false } });
        }
        return tx.sesiPemesananBuku.update({ where: { id }, data });
      });
      return this.toDto(updated);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(MSG_DUPLIKAT);
      throw e;
    }
  }

  async deleteSesi(id: string): Promise<{ success: true }> {
    const existing = await this.prisma.sesiPemesananBuku.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sesi pemesanan tidak ditemukan.');
    if ((await this.jumlahPesanan(id)) > 0) throw new BadRequestException('Sesi yang sudah memiliki pesanan tidak bisa dihapus.');
    await this.prisma.sesiPemesananBuku.delete({ where: { id } });
    return { success: true };
  }

  private async jumlahPesanan(sesiId: string): Promise<number> {
    const [c, w] = await Promise.all([
      this.prisma.pemesananBukuCabang.count({ where: { sesiId } }),
      this.prisma.pemesananBukuWilayah.count({ where: { sesiId } }),
    ]);
    return c + w;
  }

  /** sesiId kosong → sesi aktif. */
  async resolveSesi(sesiId?: string | null): Promise<SesiRow> {
    if (sesiId) {
      const s = await this.prisma.sesiPemesananBuku.findUnique({ where: { id: sesiId } });
      if (!s) throw new NotFoundException('Sesi pemesanan tidak ditemukan.');
      return s;
    }
    const aktif = await this.prisma.sesiPemesananBuku.findFirst({ where: { isActive: true } });
    if (!aktif) throw new BadRequestException('Belum ada sesi pemesanan aktif.');
    return aktif;
  }

  assertTerbuka(s: SesiRow): void {
    if (!s.isActive || !s.isOpen) throw new BadRequestException(MSG_SESI_TUTUP);
  }
}
