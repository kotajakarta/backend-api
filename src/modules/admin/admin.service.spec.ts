/**
 * Unit tests for AdminService's WALI account creation + student linking logic
 * (Task 4: admin.service.ts createUser/updateUser extensions).
 *
 * Follows the same test-infra approach as
 * src/modules/portal/portal.service.spec.ts: Node's built-in test runner
 * (`node:test`) executed through `tsx`, no live database. PrismaService is
 * hand-mocked — `$transaction` invokes the callback with a `tx` object that is
 * itself a mocked Prisma client, matching how admin.service.ts uses
 * `prisma.$transaction(async (tx) => {...})`.
 *
 * Run with:
 *   npx tsx --test src/modules/admin/admin.service.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdminService } from './admin.service.js';

function makePrisma(overrides: any = {}) {
  const tx = {
    user: {
      create: async (args: any) => ({ id: 'new-user-1', ...args.data }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      findUnique: async () => null,
      ...overrides.user
    },
    waliSantri: {
      createMany: async (args: any) => ({ count: args.data.length }),
      create: async (args: any) => ({ id: 'link-new', ...args.data }),
      delete: async (args: any) => ({ id: 'link-deleted', ...args.where }),
      deleteMany: async (args: any) => ({ count: 0 }),
      findMany: async () => [],
      ...overrides.waliSantri
    }
  };

  const prisma: any = {
    ...tx,
    $transaction: async (fn: any) => fn(tx),
    _tx: tx
  };

  return prisma;
}

describe('AdminService — createUser WALI handling', () => {
  it('WALI scope with studentIds creates the user and matching WaliSantri rows via createMany', async () => {
    const createManyCalls: any[] = [];
    const prisma = makePrisma({
      waliSantri: {
        createMany: async (args: any) => {
          createManyCalls.push(args);
          return { count: args.data.length };
        }
      }
    });
    const service = new AdminService(prisma);

    const result = await service.createUser({
      username: 'wali1',
      password: 'password123',
      scope: 'WALI',
      divisi: 'FORMAL', // should be ignored/overridden
      wilayahId: 'wilayah-should-be-ignored',
      cabangId: 'cabang-should-be-ignored',
      studentIds: ['student-1', 'student-2'],
      hubungan: 'Ayah'
    });

    assert.equal(result.id, 'new-user-1');
    assert.equal(createManyCalls.length, 1);
    assert.deepEqual(createManyCalls[0].data, [
      { userId: 'new-user-1', studentId: 'student-1', hubungan: 'Ayah' },
      { userId: 'new-user-1', studentId: 'student-2', hubungan: 'Ayah' }
    ]);
  });

  it('forces divisi: ALL, wilayahId: null, cabangId: null for WALI scope regardless of posted input', async () => {
    let capturedUserCreateArgs: any = null;
    const prisma = makePrisma({
      user: {
        create: async (args: any) => {
          capturedUserCreateArgs = args;
          return { id: 'new-user-1', ...args.data };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.createUser({
      username: 'wali2',
      password: 'password123',
      scope: 'WALI',
      divisi: 'PESANTREN',
      wilayahId: 'some-wilayah-id',
      cabangId: 'some-cabang-id'
    });

    assert.equal(capturedUserCreateArgs.data.divisi, 'ALL');
    assert.equal(capturedUserCreateArgs.data.wilayahId, null);
    assert.equal(capturedUserCreateArgs.data.cabangId, null);
  });

  it('WALI scope with no studentIds provided defaults to [] and issues no createMany call', async () => {
    let createManyCalled = false;
    const prisma = makePrisma({
      waliSantri: {
        createMany: async (args: any) => {
          createManyCalled = true;
          return { count: 0 };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.createUser({
      username: 'wali3',
      password: 'password123',
      scope: 'WALI',
      divisi: 'FORMAL'
    });

    assert.equal(createManyCalled, false);
  });

  it('non-WALI scope is unaffected — no WaliSantri calls at all, divisi/wilayah/cabang passed through as-is', async () => {
    let createManyCalled = false;
    let deleteManyCalled = false;
    let capturedUserCreateArgs: any = null;
    const prisma = makePrisma({
      user: {
        create: async (args: any) => {
          capturedUserCreateArgs = args;
          return { id: 'new-user-2', ...args.data };
        }
      },
      waliSantri: {
        createMany: async () => {
          createManyCalled = true;
          return { count: 0 };
        },
        deleteMany: async () => {
          deleteManyCalled = true;
          return { count: 0 };
        }
      }
    });
    const service = new AdminService(prisma);

    const result = await service.createUser({
      username: 'staff1',
      password: 'password123',
      scope: 'GLOBAL',
      divisi: 'FORMAL',
      wilayahId: 'wilayah-1',
      cabangId: 'cabang-1'
    });

    assert.equal(result.id, 'new-user-2');
    assert.equal(createManyCalled, false);
    assert.equal(deleteManyCalled, false);
    assert.equal(capturedUserCreateArgs.data.divisi, 'FORMAL');
    assert.equal(capturedUserCreateArgs.data.wilayahId, 'wilayah-1');
    assert.equal(capturedUserCreateArgs.data.cabangId, 'cabang-1');
  });
});

describe('AdminService — updateUser studentIds diffing', () => {
  it('diffs added/removed studentIds: existing [A, B], new [B, C] -> create C, delete A, nothing for B', async () => {
    const createCalls: any[] = [];
    const deleteCalls: any[] = [];
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'WALI', divisi: 'ALL' }),
        update: async (args: any) => ({ id: args.where.id, ...args.data })
      },
      waliSantri: {
        findMany: async () => [
          { id: 'link-a', userId: 'user-1', studentId: 'A' },
          { id: 'link-b', userId: 'user-1', studentId: 'B' }
        ],
        create: async (args: any) => {
          createCalls.push(args);
          return { id: 'link-new', ...args.data };
        },
        delete: async (args: any) => {
          deleteCalls.push(args);
          return { id: 'link-deleted', ...args.where };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      scope: 'WALI',
      divisi: 'ALL',
      studentIds: ['B', 'C']
    });

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].data.studentId, 'C');
    assert.equal(createCalls[0].data.userId, 'user-1');

    assert.equal(deleteCalls.length, 1);
    assert.deepEqual(deleteCalls[0].where, { userId_studentId: { userId: 'user-1', studentId: 'A' } });
  });

  it('studentIds omitted entirely leaves links untouched (no create/delete/deleteMany calls)', async () => {
    let createCalled = false;
    let deleteCalled = false;
    let deleteManyCalled = false;
    let findManyCalled = false;
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'WALI', divisi: 'ALL' }),
        update: async (args: any) => ({ id: args.where.id, ...args.data })
      },
      waliSantri: {
        findMany: async () => {
          findManyCalled = true;
          return [];
        },
        create: async (args: any) => {
          createCalled = true;
          return { id: 'x', ...args.data };
        },
        delete: async () => {
          deleteCalled = true;
          return {};
        },
        deleteMany: async () => {
          deleteManyCalled = true;
          return { count: 0 };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      operatorName: 'New Operator Name'
      // scope/studentIds intentionally omitted
    });

    assert.equal(createCalled, false);
    assert.equal(deleteCalled, false);
    assert.equal(deleteManyCalled, false);
    assert.equal(findManyCalled, false, 'should not even fetch current links when studentIds is omitted');
  });

  it('explicit empty array studentIds: [] removes all existing links', async () => {
    const deleteCalls: any[] = [];
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'WALI', divisi: 'ALL' }),
        update: async (args: any) => ({ id: args.where.id, ...args.data })
      },
      waliSantri: {
        findMany: async () => [
          { id: 'link-a', userId: 'user-1', studentId: 'A' },
          { id: 'link-b', userId: 'user-1', studentId: 'B' }
        ],
        delete: async (args: any) => {
          deleteCalls.push(args);
          return { id: 'deleted', ...args.where };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      scope: 'WALI',
      studentIds: []
    });

    assert.equal(deleteCalls.length, 2);
    const deletedIds = deleteCalls.map((c) => c.where.userId_studentId.studentId).sort();
    assert.deepEqual(deletedIds, ['A', 'B']);
  });

  it('changing scope away from WALI deletes all existing links for that user via deleteMany', async () => {
    let deleteManyArgs: any = null;
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'WALI', divisi: 'ALL' }),
        update: async (args: any) => ({ id: args.where.id, ...args.data })
      },
      waliSantri: {
        deleteMany: async (args: any) => {
          deleteManyArgs = args;
          return { count: 2 };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      scope: 'GLOBAL',
      divisi: 'FORMAL',
      wilayahId: 'wilayah-1'
    });

    assert.deepEqual(deleteManyArgs.where, { userId: 'user-1' });
  });

  it('forces divisi: ALL, wilayahId: null, cabangId: null when resulting scope is WALI', async () => {
    let capturedUpdateArgs: any = null;
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'WALI', divisi: 'ALL' }),
        update: async (args: any) => {
          capturedUpdateArgs = args;
          return { id: args.where.id, ...args.data };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      scope: 'WALI',
      divisi: 'PESANTREN',
      wilayahId: 'some-wilayah',
      cabangId: 'some-cabang'
    });

    assert.equal(capturedUpdateArgs.data.divisi, 'ALL');
    assert.equal(capturedUpdateArgs.data.wilayahId, null);
    assert.equal(capturedUpdateArgs.data.cabangId, null);
  });

  it('non-WALI scope (staying non-WALI) is byte-for-byte unchanged: no WaliSantri calls, fields passed through', async () => {
    let createCalled = false;
    let deleteCalled = false;
    let deleteManyCalled = false;
    let capturedUpdateArgs: any = null;
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'GLOBAL', divisi: 'FORMAL' }),
        update: async (args: any) => {
          capturedUpdateArgs = args;
          return { id: args.where.id, ...args.data };
        }
      },
      waliSantri: {
        create: async () => {
          createCalled = true;
          return {};
        },
        delete: async () => {
          deleteCalled = true;
          return {};
        },
        deleteMany: async () => {
          deleteManyCalled = true;
          return { count: 0 };
        }
      }
    });
    const service = new AdminService(prisma);

    const result = await service.updateUser('user-1', {
      username: 'staff1',
      scope: 'GLOBAL',
      divisi: 'PESANTREN',
      wilayahId: 'wilayah-9',
      cabangId: 'cabang-9'
    });

    assert.equal(createCalled, false);
    assert.equal(deleteCalled, false);
    assert.equal(deleteManyCalled, false);
    assert.equal(capturedUpdateArgs.data.divisi, 'PESANTREN');
    assert.equal(capturedUpdateArgs.data.wilayahId, 'wilayah-9');
    assert.equal(capturedUpdateArgs.data.cabangId, 'cabang-9');
    assert.equal(result.id, 'user-1');
  });

  it('password update without studentIds still hashes the password and updates it', async () => {
    let capturedUpdateArgs: any = null;
    const prisma = makePrisma({
      user: {
        findUnique: async () => ({ id: 'user-1', scope: 'GLOBAL', divisi: 'FORMAL' }),
        update: async (args: any) => {
          capturedUpdateArgs = args;
          return { id: args.where.id, ...args.data };
        }
      }
    });
    const service = new AdminService(prisma);

    await service.updateUser('user-1', {
      password: 'newpassword123'
    });

    assert.ok(capturedUpdateArgs.data.password);
    assert.notEqual(capturedUpdateArgs.data.password, 'newpassword123'); // should be hashed
  });
});

describe('AdminService — getUsers never exposes credentials', () => {
  it('excludes password, twoFactorSecret, and twoFactorBackupCodes from every returned user', async () => {
    const prisma = makePrisma({
      user: {
        findMany: async (args: any) => {
          const fullUser = {
            id: 'user-1',
            username: 'admin1',
            password: '$2b$10$hashedpasswordvalue',
            scope: 'GLOBAL',
            divisi: 'ALL',
            operatorName: null,
            wilayahId: null,
            cabangId: null,
            twoFactorEnabled: true,
            twoFactorSecret: 'JBSWY3DPEHPK3PXP',
            twoFactorBackupCodes: ['aaaa1111', 'bbbb2222'],
            wilayah: null,
            cabang: null,
            waliSantri: []
          };
          if (args?.select) {
            const result: any = {};
            for (const key in args.select) {
              if (args.select[key]) {
                result[key] = fullUser[key as keyof typeof fullUser];
              }
            }
            return [result];
          }
          return [fullUser];
        }
      }
    });
    const service = new AdminService(prisma);

    const result = await service.getUsers({ scope: 'AUDITOR' });

    assert.equal(result.length, 1);
    assert.equal('password' in result[0], false, 'password must not be selected at all');
    assert.equal('twoFactorSecret' in result[0], false, 'twoFactorSecret must not be selected at all');
    assert.equal('twoFactorBackupCodes' in result[0], false, 'twoFactorBackupCodes must not be selected at all');
  });

  it('still passes a select (not include) to findMany, with scalar + relation fields UsersWilayah.tsx renders', async () => {
    let capturedArgs: any = null;
    const prisma = makePrisma({
      user: {
        findMany: async (args: any) => {
          capturedArgs = args;
          return [];
        }
      }
    });
    const service = new AdminService(prisma);

    await service.getUsers({ scope: 'GLOBAL' });

    assert.ok(capturedArgs.select, 'must use select, not include');
    assert.equal(capturedArgs.include, undefined);
    for (const field of ['id', 'username', 'scope', 'divisi', 'operatorName', 'wilayahId', 'cabangId', 'twoFactorEnabled', 'wilayah', 'cabang', 'waliSantri']) {
      assert.equal(capturedArgs.select[field] !== undefined, true, `select must include ${field}`);
    }
    assert.equal(capturedArgs.select.password, undefined);
    assert.equal(capturedArgs.select.twoFactorSecret, undefined);
    assert.equal(capturedArgs.select.twoFactorBackupCodes, undefined);
  });
});
