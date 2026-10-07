import fs from 'node:fs';

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleepMs = (ms: number) => Atomics.wait(sleeper, 0, 0, ms);

/**
 * Write one JSON line to `fd`, synchronously and completely.
 *
 * stdout under `podman exec ... > file` is a non-blocking pipe with a 64 KB
 * buffer: a single fs.writeSync() may write only part of a large line or throw
 * EAGAIN when the pipe is full. The first production backup was silently
 * truncated that way, so loop until every byte is written, waiting briefly
 * while the reader drains the pipe. Synchronous on purpose: a journal line
 * must be out before the next row is migrated.
 */
export function writeJsonLineSync(fd: number, record: unknown): void {
  const buf = Buffer.from(JSON.stringify(record) + '\n', 'utf8');
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    } catch (err: any) {
      if (err?.code === 'EAGAIN') {
        sleepMs(5);
        continue;
      }
      throw err;
    }
  }
}
