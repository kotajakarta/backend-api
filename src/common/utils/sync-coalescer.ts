import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Coalesces "please recompute X" requests into as few actual runs as possible.
 *
 * Why this exists: saving pelaksanaan/absensi used to fire a full rekap
 * recompute on every single save. At busy hours dozens of those ran in
 * parallel on the same worker, each holding the whole semester in memory,
 * until the worker died with "JavaScript heap out of memory".
 *
 * - Debounce: requests for the same key within `debounceMs` of each other
 *   collapse into one run, but never later than `maxWaitMs` after the first
 *   pending request (so a busy hour can't postpone the rekap forever).
 * - Cluster-wide: runs are serialized through one lock in the shared store
 *   (Redis), so only one sync runs at a time across all worker processes, and
 *   a worker skips its run if another worker already started one for that key
 *   after its latest request.
 * - A request that arrives while its key is syncing triggers one more run
 *   afterwards, so the newest data is never left out.
 * - If the store is unavailable the coalescer degrades to per-process
 *   debouncing instead of dropping the sync.
 */

export interface SyncLockStore {
  tryAcquire(name: string, token: string, ttlMs: number): Promise<boolean>;
  release(name: string, token: string): Promise<void>;
  getLastStart(key: string): Promise<number | null>;
  setLastStart(key: string, at: number): Promise<void>;
}

export interface SyncCoalescerOptions {
  run: (key: string) => Promise<void>;
  store: SyncLockStore;
  namespace?: string;
  debounceMs: number;
  maxWaitMs: number;
  retryMs: number;
  lockTtlMs: number;
  logger?: { warn: (msg: string) => void; error: (msg: string) => void };
}

type KeyState = {
  timer: NodeJS.Timeout | null;
  firstPendingAt: number | null;
  lastRequestAt: number;
  busy: boolean;
};

export class SyncCoalescer {
  private readonly states = new Map<string, KeyState>();
  private readonly namespace: string;
  private readonly lockName: string;

  constructor(private readonly opts: SyncCoalescerOptions) {
    this.namespace = opts.namespace || 'sync-coalescer';
    this.lockName = `${this.namespace}:lock`;
  }

  request(key: string): void {
    const s = this.state(key);
    const now = Date.now();
    s.lastRequestAt = now;
    if (s.firstPendingAt === null) s.firstPendingAt = now;
    if (!s.busy) this.arm(key, s, this.opts.debounceMs);
  }

  private state(key: string): KeyState {
    let s = this.states.get(key);
    if (!s) {
      s = { timer: null, firstPendingAt: null, lastRequestAt: 0, busy: false };
      this.states.set(key, s);
    }
    return s;
  }

  private arm(key: string, s: KeyState, delayMs: number) {
    if (s.timer) clearTimeout(s.timer);
    const deadline = (s.firstPendingAt ?? Date.now()) + this.opts.maxWaitMs;
    const delay = Math.max(0, Math.min(delayMs, deadline - Date.now()));
    s.timer = setTimeout(() => {
      s.timer = null;
      void this.fire(key, s);
    }, delay);
  }

  private async fire(key: string, s: KeyState) {
    s.busy = true;
    const requestedAt = s.lastRequestAt;
    const token = randomUUID();

    let storeOk = true;
    let acquired = false;
    try {
      acquired = await this.opts.store.tryAcquire(this.lockName, token, this.opts.lockTtlMs);
    } catch (err: any) {
      storeOk = false;
      acquired = true;
      this.opts.logger?.warn(`Sync lock store unavailable (${err?.message}); running "${key}" without cluster coordination.`);
    }

    if (!acquired) {
      // Another worker holds the lock — retry shortly, without resetting maxWait.
      s.busy = false;
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(() => {
        s.timer = null;
        void this.fire(key, s);
      }, this.opts.retryMs);
      return;
    }

    try {
      if (storeOk) {
        const lastStart = await this.opts.store.getLastStart(this.lastStartKey(key)).catch(() => null);
        if (lastStart !== null && lastStart >= requestedAt) {
          // Another worker started this sync after our latest request — it already covers our data.
          s.firstPendingAt = null;
          return;
        }
      }

      s.firstPendingAt = null;
      const startedAt = Date.now();
      if (storeOk) await this.opts.store.setLastStart(this.lastStartKey(key), startedAt).catch(() => {});
      try {
        await this.opts.run(key);
      } catch (err: any) {
        this.opts.logger?.error(`Sync "${key}" failed: ${err?.message || err}`);
      }
    } finally {
      if (storeOk) await this.opts.store.release(this.lockName, token).catch(() => {});
      s.busy = false;
      if (s.lastRequestAt > requestedAt && !s.timer) {
        if (s.firstPendingAt === null) s.firstPendingAt = s.lastRequestAt;
        this.arm(key, s, this.opts.debounceMs);
      }
    }
  }

  private lastStartKey(key: string) {
    return `${this.namespace}:last-start:${key}`;
  }
}

const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const LAST_START_TTL_MS = 24 * 60 * 60 * 1000;

export function createRedisSyncLockStore(redis: Redis): SyncLockStore {
  return {
    tryAcquire: async (name, token, ttlMs) => (await redis.set(name, token, 'PX', ttlMs, 'NX')) === 'OK',
    release: async (name, token) => {
      await redis.eval(RELEASE_SCRIPT, 1, name, token);
    },
    getLastStart: async key => {
      const v = await redis.get(key);
      return v === null ? null : Number(v);
    },
    setLastStart: async (key, at) => {
      await redis.set(key, String(at), 'PX', LAST_START_TTL_MS);
    },
  };
}

/** In-process store: used by tests, and shared by instances in the same process. */
export function createMemorySyncLockStore(): SyncLockStore {
  const locks = new Map<string, { token: string; expiresAt: number }>();
  const lastStarts = new Map<string, number>();
  return {
    tryAcquire: async (name, token, ttlMs) => {
      const cur = locks.get(name);
      if (cur && cur.expiresAt > Date.now()) return false;
      locks.set(name, { token, expiresAt: Date.now() + ttlMs });
      return true;
    },
    release: async (name, token) => {
      if (locks.get(name)?.token === token) locks.delete(name);
    },
    getLastStart: async key => lastStarts.get(key) ?? null,
    setLastStart: async (key, at) => {
      lastStarts.set(key, at);
    },
  };
}
