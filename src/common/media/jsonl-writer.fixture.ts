// Child process for jsonl-writer.spec.ts: writes N JSON lines of the given size to stdout.
import { writeJsonLineSync } from './jsonl-writer.js';

const [n, size] = process.argv.slice(2).map(Number);
void process.stdout; // initialise stdout like a real script (libuv makes pipes non-blocking)
for (let i = 0; i < n; i++) writeJsonLineSync(1, { i, value: 'x'.repeat(size) });
