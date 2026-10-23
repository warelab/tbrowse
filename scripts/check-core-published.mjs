#!/usr/bin/env node
/**
 * Release-order guard: tbrowse depends on a published tbrowse-core range, so
 * the minimum version of that range must exist on npm BEFORE tbrowse itself is
 * published (otherwise `npm install tbrowse` fails for everyone).
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const range = pkg.dependencies?.['tbrowse-core'];
if (!range) { console.error('tbrowse-core is not a dependency'); process.exit(1); }
const m = range.match(/(\d+\.\d+\.\d+)/);
if (!m) { console.error(`cannot read a minimum version from range "${range}"`); process.exit(1); }
try {
  const v = execSync(`npm view tbrowse-core@${m[1]} version`, { stdio: 'pipe' }).toString().trim();
  if (!v) throw new Error('empty');
  console.log(`tbrowse-core@${m[1]} is published (${v}); OK to publish tbrowse`);
} catch {
  console.error(`tbrowse-core@${m[1]} is NOT on npm yet — run \`npm run release:core\` first`);
  process.exit(1);
}
