/**
 * Unit tests for PortalService.
 *
 * Follows the same test-infra approach as
 * src/common/guards/access-control.guard.spec.ts: Node's built-in test runner
 * (`node:test`) executed through `tsx`, no live database. PrismaService, FormalService,
 * and AuthService are hand-mocked plain objects — only the methods PortalService
 * actually calls are stubbed.
 *
 * Run with:
 *   npx tsx --test src/modules/portal/portal.service.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PortalService } from './portal.service.js';

function makePrisma(overrides: any = {}) {
  return {
    waliSantri: {
      findUnique: async () => null,
      findMany: async () => [],
      ...overrides.waliSantri
    },
    permohonanIzinSantri: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args: any) => ({ id: 'created-1', ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      ...overrides.permohonanIzinSantri
    },
    student: {
      findUnique: async () => null,
      ...overrides.student
    },
    kehadiran: {
      findMany: async () => [],
      ...overrides.kehadiran
    },
    pengumuman: {
      findMany: async () => [],
      ...overrides.pengumuman
    },
    staff: {
      findMany: async () => [],
      findUnique: async () => null,
      ...overrides.staff
    }
  } as any;
}

function makeFormalService(overrides: any = {}) {
  return {
    getRiwayatKelasByStudent: async () => [],
    getNilaiHistoryByStudent: async () => [],
    getERaporCetak: async () => ({}),
    getHafalanByStudent: async () => null,
    checkStudentScope: async () => undefined,
    ...overrides
  } as any;
}

function makeAuthService(overrides: any = {}) {
  return {
    updateProfile: async () => ({ token: 'x', user: {} }),
    ...overrides
  } as any;
}

function makePengaturanService(overrides: any = {}) {
  return {
    getModuleSettings: async () => ({ walsanEditBiodataEnabled: true, cabangEditBiodataMap: {} }),
    ...overrides
  } as any;
}

describe('PortalService — assertOwnsStudent (ownership gate)', () => {
  it('passes silently when a WaliSantri link exists', async () => {
    const prisma = makePrisma({
      waliSantri: { findUnique: async () => ({ id: 'link-1', userId: 'user-1', studentId: 'student-1' }) }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.doesNotReject(() => service.assertOwnsStudent('user-1', 'student-1'));
  });

  it('throws ForbiddenException when no WaliSantri link exists', async () => {
    const prisma = makePrisma({ waliSantri: { findUnique: async () => null } });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () => service.assertOwnsStudent('user-1', 'student-not-owned'),
      (err: unknown) => err instanceof ForbiddenException
    );
  });

  it('queries with the userId_studentId composite unique key', async () => {
    let capturedWhere: any = null;
    const prisma = makePrisma({
      waliSantri: {
        findUnique: async (args: any) => {
          capturedWhere = args.where;
          return { id: 'link-1' };
        }
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await service.assertOwnsStudent('user-42', 'student-99');

    assert.deepEqual(capturedWhere, { userId_studentId: { userId: 'user-42', studentId: 'student-99' } });
  });
});

describe('PortalService — listPermohonanIzinStaff scope-based where-clause construction', () => {
  it('CABANG scope filters by the student\'s cabangId', async () => {
    let capturedArgs: any = null;
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findMany: async (args: any) => {
          capturedArgs = args;
          return [];
        }
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await service.listPermohonanIzinStaff({ id: 'staff-1', scope: 'CABANG', cabangId: 'cabang-1' });

    assert.deepEqual(capturedArgs.where, { student: { cabangId: 'cabang-1' } });
  });

  it('WILAYAH scope filters by the student\'s wilayahId', async () => {
    let capturedArgs: any = null;
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findMany: async (args: any) => {
          capturedArgs = args;
          return [];
        }
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await service.listPermohonanIzinStaff({ id: 'staff-1', scope: 'WILAYAH', wilayahId: 'wilayah-1' });

    assert.deepEqual(capturedArgs.where, { student: { wilayahId: 'wilayah-1' } });
  });

  it('GLOBAL scope applies no filter', async () => {
    let capturedArgs: any = null;
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findMany: async (args: any) => {
          capturedArgs = args;
          return [];
        }
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await service.listPermohonanIzinStaff({ id: 'staff-1', scope: 'GLOBAL' });

    assert.deepEqual(capturedArgs.where, {});
  });
});

describe('PortalService — createPermohonanIzin date validation', () => {
  const ownedPrismaOverrides = {
    waliSantri: { findUnique: async () => ({ id: 'link-1' }) }
  };

  it('throws BadRequestException when tanggalSelesai is before tanggalMulai', async () => {
    const prisma = makePrisma(ownedPrismaOverrides);
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () =>
        service.createPermohonanIzin('user-1', {
          studentId: 'student-1',
          jenisIzin: 'IZIN_PULANG',
          keterangan: 'Acara keluarga',
          tanggalMulai: '2026-08-10',
          tanggalSelesai: '2026-08-09'
        } as any),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it('accepts when tanggalSelesai equals tanggalMulai (same-day leave)', async () => {
    const prisma = makePrisma(ownedPrismaOverrides);
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    const result = await service.createPermohonanIzin('user-1', {
      studentId: 'student-1',
      jenisIzin: 'SAKIT',
      keterangan: 'Demam',
      tanggalMulai: '2026-08-10',
      tanggalSelesai: '2026-08-10'
    } as any);

    assert.equal(result.id, 'created-1');
  });

  it('accepts when tanggalSelesai is after tanggalMulai', async () => {
    const prisma = makePrisma(ownedPrismaOverrides);
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    const result = await service.createPermohonanIzin('user-1', {
      studentId: 'student-1',
      jenisIzin: 'LAINNYA',
      keterangan: 'Keperluan keluarga',
      tanggalMulai: '2026-08-10',
      tanggalSelesai: '2026-08-15'
    } as any);

    assert.equal(result.id, 'created-1');
  });

  it('runs the ownership check before the date validation (still rejects with ForbiddenException for an unowned student, not BadRequestException)', async () => {
    const prisma = makePrisma({ waliSantri: { findUnique: async () => null } });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () =>
        service.createPermohonanIzin('user-1', {
          studentId: 'student-not-owned',
          jenisIzin: 'SAKIT',
          keterangan: 'Demam',
          tanggalMulai: '2026-08-10',
          tanggalSelesai: '2026-08-01' // would also fail date validation, but ownership must win
        } as any),
      (err: unknown) => err instanceof ForbiddenException
    );
  });
});

describe('PortalService — approvePermohonanIzin / rejectPermohonanIzin PENDING-status guard', () => {
  it('approvePermohonanIzin throws BadRequestException when the record is already APPROVED', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'APPROVED' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () => service.approvePermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it('approvePermohonanIzin throws BadRequestException when the record is already REJECTED', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'REJECTED' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () => service.approvePermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it('rejectPermohonanIzin throws BadRequestException when the record is already APPROVED', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'APPROVED' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () => service.rejectPermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' }, 'Alasan penolakan'),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it('rejectPermohonanIzin throws BadRequestException when the record is already REJECTED', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'REJECTED' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(
      () => service.rejectPermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' }, 'Alasan penolakan'),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it('approvePermohonanIzin succeeds and transitions status when the record is PENDING', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'PENDING' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    const result = await service.approvePermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' });
    assert.equal(result.status, 'APPROVED');
  });

  it('rejectPermohonanIzin succeeds and transitions status when the record is PENDING', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', studentId: 'student-1', status: 'PENDING' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    const result = await service.rejectPermohonanIzin('izin-1', { id: 'staff-1', scope: 'GLOBAL' }, 'Alasan penolakan');
    assert.equal(result.status, 'REJECTED');
  });
});

describe('PortalService — getPermohonanIzinById caller-ownership check', () => {
  it('returns the record when createdById matches the caller', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', createdById: 'user-1' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    const result = await service.getPermohonanIzinById('user-1', 'izin-1');
    assert.equal(result.id, 'izin-1');
  });

  it('throws when the record belongs to a different user', async () => {
    const prisma = makePrisma({
      permohonanIzinSantri: {
        findUnique: async () => ({ id: 'izin-1', createdById: 'someone-else' })
      }
    });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(() => service.getPermohonanIzinById('user-1', 'izin-1'));
  });

  it('throws when the record does not exist', async () => {
    const prisma = makePrisma({ permohonanIzinSantri: { findUnique: async () => null } });
    const service = new PortalService(prisma, makeFormalService(), makeAuthService(), makePengaturanService());

    await assert.rejects(() => service.getPermohonanIzinById('user-1', 'missing'));
  });
});
