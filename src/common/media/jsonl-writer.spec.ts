/**
 * Unit tests for jsonl-writer: JSON Lines written to a (non-blocking) pipe
 * must arrive complete. `podman exec ... > file` gives the process a pipe with
 * a 64 KB buffer; a bare fs.writeSync() may write only part of a large line
 * or fail with EAGAIN, which corrupted the first production backup.
 *
 * Run with:
 *   npx tsx --test src/common/media/jsonl-writer.spec.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function runWriterThroughSlowPipe(lines: number, lineBytes: number): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'jsonl-writer.fixture.ts'), String(lines), String(lineBytes)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    // Slow consumer: pause after every chunk so the pipe buffer fills up.
    child.stdout.on('data', c => {
      chunks.push(c);
      child.stdout.pause();
      setTimeout(() => child.stdout.resume(), 2);
    });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`exit ${code}`))));
  });
}

describe('writeJsonLineSync', () => {
  it('delivers every large line intact through a slow pipe', { timeout: 120_000 }, async () => {
    const out = await runWriterThroughSlowPipe(120, 200_000);
    const lines = out.split('\n').filter(Boolean);
    assert.equal(lines.length, 120);
    lines.forEach((l, i) => {
      const rec = JSON.parse(l);
      assert.equal(rec.i, i);
      assert.equal(rec.value.length, 200_000);
    });
  });
});
