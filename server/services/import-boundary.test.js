import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function walkJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJsFiles(path));
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

test('runtime server modules do not import from src/ (Docker copies only server/)', () => {
  const offenders = [];
  for (const file of walkJsFiles(serverRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.includes('/src/') || spec.startsWith('../../src') || spec.startsWith('../../../src')) {
        offenders.push(`${file.slice(serverRoot.length + 1)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
