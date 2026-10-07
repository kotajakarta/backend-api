/**
 * Unit tests for SyncCoalescer.
 *
 * Run with:
 *   npx tsx --test src/common/utils/sync-coalescer.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncCoalescer, createMemorySyncLockStore, SyncLockStore } from './sync-coalescer.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function makeRunner(durationMs = 0) {
  const runs: string[] = [];
  let active = 0;
  let maxActive = 0;
  const run = async (key: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    runs.push(key);
    await sleep(durationMs);
    active--;
  };
  return { run, runs, maxActive: () => maxActive };
}

const opts = { debounceMs: 30, maxWaitMs: 1000, retryMs: 20, lockTtlMs: 5000 };

describe('SyncCoalescer', () => {
  it('runs a burst of requests for the same key only once, after the debounce window', async () => {
    const r = makeRunner();
    const c = new SyncCoalescer({ ...opts, store: createMemorySyncLockStore(), run: r.run });
    for (let i = 0; i < 20; i++) c.request('semester');
    assert.equal(r.runs.length, 0, 'must not run synchronously on request');
    await sleep(120);
    assert.deepEqual(r.runs, ['semester']);
  });

  it('runs each distinct key once', async () => {
    const r = makeRunner();
    const c = new SyncCoalescer({ ...opts, store: createMemorySyncLockStore(), run: r.run });
    c.request('monthly:2026-09');
    c.request('semester');
    c.request('monthly:2026-09');
    await sleep(150);
    assert.deepEqual([...r.runs].sort(), ['monthly:2026-09', 'semester']);
  });

  it('coalesces the same key across workers sharing a lock store (one run total)', async () => {
    const r = makeRunner(60);
    const store = createMemorySyncLockStore();
    const workerA = new SyncCoalescer({ ...opts, store, run: r.run });
    const workerB = new SyncCoalescer({ ...opts, store, run: r.run });
    workerA.request('semester');
    workerB.request('semester');
    await sleep(300);
    assert.deepEqual(r.runs, ['semester']);
  });

  it('never runs two syncs at the same time across workers', async () => {
    const r = makeRunner(40);
    const store = createMemorySyncLockStore();
    const workerA = new SyncCoalescer({ ...opts, store, run: r.run });
    const workerB = new SyncCoalescer({ ...opts, store, run: r.run });
    workerA.request('semester');
    workerB.request('monthly:2026-09');
    workerA.request('monthly:2026-08');
    await sleep(500);
    assert.equal(r.runs.length, 3);
    assert.equal(r.maxActive(), 1);
  });

  it('re-runs once when a request arrives while that key is already syncing', async () => {
    const r = makeRunner(80);
    const c = new SyncCoalescer({ ...opts, store: createMemorySyncLockStore(), run: r.run });
    c.request('semester');
    await sleep(60); // debounce elapsed, sync in progress
    assert.equal(r.runs.length, 1);
    c.request('semester');
    c.request('semester');
    await sleep(300);
    assert.deepEqual(r.runs, ['semester', 'semester']);
  });

  it('does not let a continuous stream of requests postpone the sync past maxWaitMs', async () => {
    const r = makeRunner();
    const c = new SyncCoalescer({ ...opts, debounceMs: 50, maxWaitMs: 120, store: createMemorySyncLockStore(), run: r.run });
    const started = Date.now();
    while (Date.now() - started < 250 && r.runs.length === 0) {
      c.request('semester');
      await sleep(10);
    }
    assert.equal(r.runs.length, 1);
    assert.ok(Date.now() - started < 220, `ran after ${Date.now() - started}ms, expected ~maxWaitMs`);
  });

  it('still runs when the lock store is unavailable', async () => {
    const r = makeRunner();
    const broken: SyncLockStore = {
      tryAcquire: async () => { throw new Error('redis down'); },
      release: async () => { throw new Error('redis down'); },
      getLastStart: async () => { throw new Error('redis down'); },
      setLastStart: async () => { throw new Error('redis down'); },
    };
    const c = new SyncCoalescer({ ...opts, store: broken, run: r.run, logger: { warn: () => {}, error: () => {} } });
    c.request('semester');
    await sleep(120);
    assert.deepEqual(r.runs, ['semester']);
  });

  it('keeps going after a run throws', async () => {
    let calls = 0;
    const c = new SyncCoalescer({
      ...opts,
      store: createMemorySyncLockStore(),
      run: async () => { calls++; if (calls === 1) throw new Error('boom'); },
      logger: { warn: () => {}, error: () => {} },
    });
    c.request('semester');
    await sleep(100);
    c.request('semester');
    await sleep(100);
    assert.equal(calls, 2);
  });
});

// Integration: runs only when a disposable Redis is available, e.g.
//   REDIS_TEST_URL=redis://localhost:16379 npx tsx --test src/common/utils/sync-coalescer.spec.ts
describe('createRedisSyncLockStore', { skip: !process.env.REDIS_TEST_URL && 'REDIS_TEST_URL not set' }, () => {
  it('coordinates two workers with separate Redis connections into a single run', async () => {
    const { Redis } = await import('ioredis');
    const { createRedisSyncLockStore } = await import('./sync-coalescer.js');
    const a = new Redis(process.env.REDIS_TEST_URL!);
    const b = new Redis(process.env.REDIS_TEST_URL!);
    const namespace = `test:coalescer:${Date.now()}`;
    try {
      const r = makeRunner(60);
      const workerA = new SyncCoalescer({ ...opts, namespace, store: createRedisSyncLockStore(a), run: r.run });
      const workerB = new SyncCoalescer({ ...opts, namespace, store: createRedisSyncLockStore(b), run: r.run });
      workerA.request('semester');
      workerB.request('semester');
      workerB.request('monthly:2026-09');
      await sleep(500);
      assert.deepEqual([...r.runs].sort(), ['monthly:2026-09', 'semester']);
      assert.equal(r.maxActive(), 1);
      assert.equal(await a.get(`${namespace}:lock`), null, 'lock must be released');
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });

  it('only releases the lock for the token that holds it', async () => {
    const { Redis } = await import('ioredis');
    const { createRedisSyncLockStore } = await import('./sync-coalescer.js');
    const redis = new Redis(process.env.REDIS_TEST_URL!);
    const store = createRedisSyncLockStore(redis);
    const name = `test:coalescer:${Date.now()}:lock`;
    try {
      assert.equal(await store.tryAcquire(name, 'owner', 5000), true);
      assert.equal(await store.tryAcquire(name, 'other', 5000), false);
      await store.release(name, 'other');
      assert.equal(await redis.get(name), 'owner');
      await store.release(name, 'owner');
      assert.equal(await redis.get(name), null);
    } finally {
      redis.disconnect();
    }
  });
});
