/**
 * Unit tests for AccessControlGuard.
 *
 * Test infra note: this repo has no test runner installed (no Jest/Vitest/etc. in
 * package.json, confirmed by inspecting devDependencies and node_modules). To avoid
 * pulling in a new framework/dependency to cover a single guard file, these tests use
 * Node's built-in test runner (`node:test`, available natively since the project runs
 * on Node 24) executed through `tsx`, which is already a devDependency used for `dev`.
 *
 * Run with:
 *   npx tsx --test src/common/guards/access-control.guard.spec.ts
 *
 * Rather than mocking the `jsonwebtoken` module, tokens are signed for real with the
 * same secret/issuer/audience the guard verifies against — this exercises the guard's
 * actual `jwt.verify` call path instead of bypassing it, while still keeping the test
 * hermetic (Reflector and PrismaService are hand-mocked, no DB/network access).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

// The guard module reads process.env.JWT_SECRET at import time and throws if missing,
// so the env var must be set before the dynamic import below.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-access-control-guard-spec';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'edaimi-backend-api';
const JWT_AUDIENCE = 'edaimi-clients';

const { AccessControlGuard } = await import('./access-control.guard.js');

type ScopePayload = {
  id?: string;
  scope?: 'GLOBAL' | 'WILAYAH' | 'CABANG' | 'WALI';
  divisi?: string;
};

function signToken(payload: ScopePayload = {}): string {
  return jwt.sign({ id: 'user-1', ...payload }, JWT_SECRET as string, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
  });
}

function makeReflector(requiredScope?: string, requiredDivisi?: string) {
  return {
    getAllAndOverride: (key: string) => {
      if (key === 'requireScope') return requiredScope;
      if (key === 'requireDivisi') return requiredDivisi;
      return undefined;
    },
  } as any;
}

function makePrisma(userExists = true) {
  return {
    user: {
      findUnique: async () => (userExists ? { id: 'user-1' } : null),
    },
  } as any;
}

function makeContext(token: string): ExecutionContext {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function RouteHandler() {},
    getClass: () => class RouteController {},
  } as unknown as ExecutionContext;
}

async function activate(
  requiredScope: string | undefined,
  requiredDivisi: string | undefined,
  payload: ScopePayload
) {
  const guard = new AccessControlGuard(makeReflector(requiredScope, requiredDivisi), makePrisma());
  const context = makeContext(signToken(payload));
  return guard.canActivate(context);
}

describe('AccessControlGuard — WALI default-deny hardening', () => {
  it('WALI token hitting a route with @RequireScope(\'WALI\') passes', async () => {
    const result = await activate('WALI', undefined, { scope: 'WALI' });
    assert.equal(result, true);
  });

  it('WALI token hitting a route with @RequireScope(\'GLOBAL\') is rejected with 403', async () => {
    await assert.rejects(
      () => activate('GLOBAL', undefined, { scope: 'WALI' }),
      (err: unknown) => err instanceof ForbiddenException
    );
  });

  it('WALI token hitting a route with NO @RequireScope at all is rejected with 403 (core regression fix)', async () => {
    await assert.rejects(
      () => activate(undefined, undefined, { scope: 'WALI' }),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        (err as ForbiddenException).message === 'Akun wali santri tidak memiliki akses ke endpoint ini'
    );
  });

  it('GLOBAL token hitting a route with @RequireScope(\'WALI\') is rejected with 403 (staff cannot reach portal-only routes)', async () => {
    await assert.rejects(
      () => activate('WALI', undefined, { scope: 'GLOBAL' }),
      (err: unknown) =>
        err instanceof ForbiddenException &&
        (err as ForbiddenException).message === 'Endpoint khusus portal wali santri'
    );
  });
});

describe('AccessControlGuard — GLOBAL/WILAYAH behavior unchanged (regression guard for the restructure)', () => {
  it('GLOBAL token passes a route requiring GLOBAL', async () => {
    const result = await activate('GLOBAL', undefined, { scope: 'GLOBAL' });
    assert.equal(result, true);
  });

  it('WILAYAH token is rejected from a route requiring GLOBAL', async () => {
    await assert.rejects(
      () => activate('GLOBAL', undefined, { scope: 'WILAYAH' }),
      (err: unknown) =>
        err instanceof ForbiddenException && (err as ForbiddenException).message === 'Requires GLOBAL scope'
    );
  });

  it('WILAYAH token passes a route requiring WILAYAH', async () => {
    const result = await activate('WILAYAH', undefined, { scope: 'WILAYAH' });
    assert.equal(result, true);
  });

  it('GLOBAL token passes a route requiring WILAYAH (GLOBAL satisfies WILAYAH, unchanged hierarchy)', async () => {
    const result = await activate('WILAYAH', undefined, { scope: 'GLOBAL' });
    assert.equal(result, true);
  });

  it('CABANG token is rejected from a route requiring WILAYAH', async () => {
    await assert.rejects(
      () => activate('WILAYAH', undefined, { scope: 'CABANG' }),
      (err: unknown) =>
        err instanceof ForbiddenException && (err as ForbiddenException).message === 'Requires WILAYAH scope'
    );
  });

  it('GLOBAL/WILAYAH/CABANG staff tokens all still pass a route with NO @RequireScope at all (only WALI is newly blocked)', async () => {
    for (const scope of ['GLOBAL', 'WILAYAH', 'CABANG'] as const) {
      const result = await activate(undefined, undefined, { scope });
      assert.equal(result, true, `expected ${scope} to still pass an unguarded route`);
    }
  });
});

describe('AccessControlGuard — divisi check is skipped for WALI tokens', () => {
  it('WALI token with mismatched divisi still passes a route requiring RequireScope(\'WALI\') + RequireDivisi(\'FORMAL\') (divisi check is skipped for WALI, isolated from the default-deny rule since requiredScope === \'WALI\' here)', async () => {
    const result = await activate('WALI', 'FORMAL', { scope: 'WALI', divisi: 'PESANTREN' });
    assert.equal(result, true);
  });

  it('WALI token with no divisi field at all still passes a route requiring RequireScope(\'WALI\') + RequireDivisi(\'FORMAL\')', async () => {
    const result = await activate('WALI', 'FORMAL', { scope: 'WALI' });
    assert.equal(result, true);
  });

  it(
    'non-WALI staff token with mismatched divisi is still rejected with the Divisi error (unchanged behavior for staff)',
    async () => {
      await assert.rejects(
        () => activate(undefined, 'FORMAL', { scope: 'GLOBAL', divisi: 'PESANTREN' }),
        (err: unknown) =>
          err instanceof ForbiddenException && (err as ForbiddenException).message === 'Insufficient Divisi access'
      );
    }
  );

  it(
    'WALI token hitting a hypothetical route with @RequireDivisi(\'FORMAL\') and NO @RequireScope is blocked by the ' +
      'default-deny rule, not by a divisi error — proving the divisi check itself was skipped (if it had NOT been ' +
      'skipped, payload.divisi undefined !== \'FORMAL\'/\'ALL\' would throw "Insufficient Divisi access" first; ' +
      'instead it throws the WALI default-deny message, so the divisi block executed no check at all for this token)',
    async () => {
      await assert.rejects(
        () => activate(undefined, 'FORMAL', { scope: 'WALI' }),
        (err: unknown) =>
          err instanceof ForbiddenException &&
          (err as ForbiddenException).message === 'Akun wali santri tidak memiliki akses ke endpoint ini'
      );
    }
  );
});

describe('AccessControlGuard — unrelated behavior sanity checks', () => {
  it('rejects requests with no Authorization header', async () => {
    const guard = new AccessControlGuard(makeReflector(undefined, undefined), makePrisma());
    const req: any = { headers: {} };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => function RouteHandler() {},
      getClass: () => class RouteController {},
    } as unknown as ExecutionContext;

    await assert.rejects(() => guard.canActivate(context), (err: unknown) => err instanceof UnauthorizedException);
  });

  it('rejects a valid token whose user no longer exists in the database', async () => {
    const guard = new AccessControlGuard(makeReflector(undefined, undefined), makePrisma(false));
    const context = makeContext(signToken({ scope: 'GLOBAL' }));

    await assert.rejects(() => guard.canActivate(context), (err: unknown) => err instanceof UnauthorizedException);
  });
});
