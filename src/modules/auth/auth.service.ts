import { Injectable, UnauthorizedException, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { assertModuleEnabled } from '../../common/utils/module-guard.js';

/**
 * JWT Security Hardening:
 * - No fallback secret — application MUST fail to start if JWT_SECRET is missing.
 * - Issuer (iss) and Audience (aud) claims for token binding.
 * - Short-lived tokens (8 hours) to minimize exposure window.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
}

const JWT_ISSUER = 'edaimi-backend-api';
const JWT_AUDIENCE = 'edaimi-clients';

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async login(username: string, passwordPlain: string) {
    const user = await this.prisma.user.findUnique({ 
      where: { username },
      include: {
        wilayah: true,
        cabang: true,
        staff: true,
      }
    });
    if (!user) {
      // Use identical error message for both cases to prevent username enumeration
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(passwordPlain, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check approval status for WALI accounts
    if (user.scope === 'WALI') {
      assertModuleEnabled('portalWalsanEnabled', 'Modul Portal Wali Santri saat ini sedang dinonaktifkan oleh Administrator Pusat.');
      if (user.isApproved === false || user.status === 'PENDING') {
        throw new ForbiddenException('Akun Anda sedang menunggu persetujuan (approval) dari pihak Cabang atau Admin Pusat.');
      }
      if (user.status === 'REJECTED') {
        throw new ForbiddenException('Pendaftaran akun Anda ditolak oleh pihak Cabang / Admin Pusat. Silakan hubungi pihak pesantren.');
      }
    }

    // Check if 2FA is enabled for this account
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const tempToken = jwt.sign(
        { id: user.id, is2FATemp: true },
        JWT_SECRET as string,
        { expiresIn: '5m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
      );
      return {
        requires2FA: true,
        tempToken,
        username: user.username
      };
    }

    const payload = {
      id: user.id,
      username: user.username,
      operatorName: user.operatorName || user.staff?.name || null,
      scope: user.scope,
      divisi: user.divisi,
      staffId: user.staffId || null,
      wilayahId: user.wilayahId || user.staff?.wilayahId || null,
      cabangId: user.cabangId || user.staff?.cabangId || null,
      wilayahName: user.wilayah?.name || null,
      cabangName: user.cabang?.name || null,
      twoFactorEnabled: false
    };

    const token = jwt.sign(payload, JWT_SECRET as string, {
      expiresIn: '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      token,
      user: payload,
    };
  }

  async verify2FALogin(tempToken: string, code: string) {
    if (!tempToken || !code) {
      throw new BadRequestException('Token verifikasi dan Kode 2FA wajib diisi');
    }

    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET as string, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Token verifikasi tidak valid atau telah kedaluwarsa');
    }

    if (!decoded || !decoded.is2FATemp || !decoded.id) {
      throw new UnauthorizedException('Token 2FA tidak valid');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        wilayah: true,
        cabang: true,
        staff: true
      }
    });

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Pengaturan 2FA tidak ditemukan pada akun ini');
    }

    const cleanCode = code.trim().replace(/\s+/g, '');
    const totpResult = verifySync({ token: cleanCode, secret: user.twoFactorSecret });
    let isValidCode = !!(totpResult && totpResult.valid);
    let isBackupUsed = false;
    let updatedBackupCodes = user.twoFactorBackupCodes || [];

    if (!isValidCode && updatedBackupCodes.length > 0) {
      const backupIndex = updatedBackupCodes.findIndex(b => b.toUpperCase() === cleanCode.toUpperCase());
      if (backupIndex !== -1) {
        isValidCode = true;
        isBackupUsed = true;
        updatedBackupCodes.splice(backupIndex, 1);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: updatedBackupCodes }
        });
      }
    }

    if (!isValidCode) {
      throw new UnauthorizedException('Kode Authenticator atau Kode Cadangan tidak sesuai');
    }

    const payload = {
      id: user.id,
      username: user.username,
      operatorName: user.operatorName || user.staff?.name || null,
      scope: user.scope,
      divisi: user.divisi,
      staffId: user.staffId || null,
      wilayahId: user.wilayahId || user.staff?.wilayahId || null,
      cabangId: user.cabangId || user.staff?.cabangId || null,
      wilayahName: user.wilayah?.name || null,
      cabangName: user.cabang?.name || null,
      twoFactorEnabled: true
    };

    const token = jwt.sign(payload, JWT_SECRET as string, {
      expiresIn: '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      token,
      user: payload,
      isBackupUsed
    };
  }

  async get2FAStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return {
      enabled: !!user.twoFactorEnabled,
      backupCodesLeft: user.twoFactorBackupCodes?.length || 0
    };
  }

  async generate2FASecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const secret = generateSecret();
    const otpauthUrl = generateURI({ secret, label: user.username, issuer: 'Pusdatin e-Santri' });
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    return {
      secret,
      qrCodeUrl
    };
  }

  async enable2FA(userId: string, secret: string, code: string) {
    if (!secret || !code) {
      throw new BadRequestException('Kunci rahasia dan Kode Verifikasi wajib diisi');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const cleanCode = code.trim().replace(/\s+/g, '');
    const totpResult = verifySync({ token: cleanCode, secret });
    const isValid = !!(totpResult && totpResult.valid);
    if (!isValid) {
      throw new BadRequestException('Kode verifikasi 2FA tidak sesuai. Pastikan jam HP Anda akurat.');
    }

    // Generate 8 backup recovery codes
    const backupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const codePart = crypto.randomBytes(4).toString('hex').toUpperCase();
      backupCodes.push(`${codePart.slice(0, 4)}-${codePart.slice(4)}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorBackupCodes: backupCodes
      }
    });

    return {
      success: true,
      backupCodes
    };
  }

  async disable2FA(userId: string, codeOrPassword?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    if (codeOrPassword && user.twoFactorSecret) {
      const cleanCode = codeOrPassword.trim().replace(/\s+/g, '');
      const totpResult = verifySync({ token: cleanCode, secret: user.twoFactorSecret });
      const isValidTOTP = !!(totpResult && totpResult.valid);
      const isPasswordMatch = await bcrypt.compare(codeOrPassword, user.password);
      if (!isValidTOTP && !isPasswordMatch) {
        throw new BadRequestException('Kode Authenticator atau Password tidak sesuai');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: []
      }
    });

    return { success: true };
  }

  async updateProfile(userId: string, data: any, isGlobalAdmin: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wilayah: true,
        cabang: true
      }
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const updateData: any = {};

    if (data.operatorName !== undefined) {
      updateData.operatorName = data.operatorName || null;
    }

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    if (data.username && data.username !== user.username) {
      if (!isGlobalAdmin) {
        throw new ForbiddenException('Hanya Administrator yang dapat mengubah username');
      }
      const existing = await this.prisma.user.findUnique({
        where: { username: data.username }
      });
      if (existing) {
        throw new BadRequestException('Username sudah digunakan');
      }
      updateData.username = data.username;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        wilayah: true,
        cabang: true
      }
    });

    const payload = {
      id: updatedUser.id,
      username: updatedUser.username,
      operatorName: updatedUser.operatorName || null,
      scope: updatedUser.scope,
      divisi: updatedUser.divisi,
      wilayahId: updatedUser.wilayahId,
      cabangId: updatedUser.cabangId,
      wilayahName: updatedUser.wilayah?.name || null,
      cabangName: updatedUser.cabang?.name || null,
      twoFactorEnabled: !!updatedUser.twoFactorEnabled
    };

    const token = jwt.sign(payload, JWT_SECRET as string, {
      expiresIn: '8h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      token,
      user: payload
    };
  }

  // --- WALI SANTRI REGISTRASI MANDIRI & VERIFIKASI ---

  async verifyStudentForWalsan(nik: string, tanggalLahir: string) {
    if (!nik || !tanggalLahir) {
      throw new BadRequestException('NIK dan Tanggal Lahir santri wajib diisi');
    }

    const cleanNik = nik.trim();
    const student = await this.prisma.student.findFirst({
      where: {
        biodata: {
          nik: cleanNik
        }
      },
      include: {
        biodata: true,
        cabang: true,
        siswaFormal: { include: { kelas: true } },
        waliSantri: {
          include: {
            user: true
          }
        }
      }
    });

    if (!student || !student.biodata) {
      throw new NotFoundException('Data santri dengan NIK tersebut tidak ditemukan di sistem.');
    }

    // Compare Tanggal Lahir (ignore time)
    if (student.biodata.tanggalLahir) {
      const dbDateStr = new Date(student.biodata.tanggalLahir).toISOString().split('T')[0];
      const inputDateStr = new Date(tanggalLahir).toISOString().split('T')[0];
      if (dbDateStr !== inputDateStr) {
        throw new BadRequestException('Tanggal lahir santri tidak cocok dengan data terdaftar.');
      }
    }

    // Check if student already has an active or pending Walsan account
    const existingWali = student.waliSantri && student.waliSantri.some(
      (ws) => ws.user && ws.user.status !== 'REJECTED'
    );
    if (existingWali) {
      throw new BadRequestException('Akun Walsan untuk Santri ini sudah terdaftar, silahkan menghubungi Cabang Terkait.');
    }

    return {
      verified: true,
      student: {
        id: student.id,
        fullName: student.biodata.fullName,
        nik: student.biodata.nik,
        nisLokal: student.biodata.nisLokal,
        cabangId: student.cabangId,
        cabangName: student.cabang?.name || 'Pusat',
        kelasName: student.siswaFormal?.kelas?.name || 'Belum Ditentukan'
      }
    };
  }

  async checkUsernameAvailable(username: string) {
    if (!username || !username.trim()) {
      return { available: false, message: 'Username tidak boleh kosong' };
    }
    const cleanUsername = username.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    return {
      available: !existing,
      message: existing ? 'Username sudah digunakan, silakan pilih yang lain' : 'Username tersedia'
    };
  }

  async registerWalsan(data: {
    studentId: string;
    namaWalsan: string;
    nikWalsan?: string;
    hubungan: string;
    username: string;
    password: string;
    phone: string;
  }) {
    if (!data.studentId || !data.namaWalsan || !data.username || !data.password || !data.phone) {
      throw new BadRequestException('Data pendaftaran wali santri tidak lengkap. Nomor WhatsApp / HP wajib diisi.');
    }

    const cleanUsername = data.username.trim().toLowerCase();

    // Check student existence
    const student = await this.prisma.student.findUnique({
      where: { id: data.studentId },
      include: { biodata: true }
    });
    if (!student) {
      throw new NotFoundException('Data santri tidak ditemukan');
    }

    // Check if student already has a Walsan account
    const existingWali = await this.prisma.waliSantri.findFirst({
      where: {
        studentId: data.studentId,
        user: {
          status: { not: 'REJECTED' }
        }
      }
    });
    if (existingWali) {
      throw new BadRequestException('Akun Walsan untuk Santri ini sudah terdaftar, silahkan menghubungi Cabang Terkait.');
    }

    // Check username uniqueness
    const existingUser = await this.prisma.user.findUnique({
      where: { username: cleanUsername }
    });
    if (existingUser) {
      throw new BadRequestException('Username sudah digunakan oleh akun lain');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: cleanUsername,
          password: hashedPassword,
          scope: 'WALI',
          divisi: 'ALL',
          operatorName: data.namaWalsan.trim(),
          nik: data.nikWalsan ? data.nikWalsan.trim() : null,
          phone: data.phone ? data.phone.trim() : null,
          isApproved: false,
          status: 'PENDING',
          cabangId: student.cabangId
        }
      });

      await tx.waliSantri.create({
        data: {
          userId: newUser.id,
          studentId: student.id,
          hubungan: data.hubungan?.trim() || 'Wali',
          status: 'PENDING'
        }
      });

      return {
        message: 'Pendaftaran akun wali santri berhasil. Akun Anda saat ini berstatus MENUNGGU PERSETUJUAN dari pihak Cabang / Admin Pusat sebelum dapat digunakan untuk login.',
        userId: newUser.id,
        username: newUser.username,
        status: 'PENDING'
      };
    });
  }
}
