#!/usr/bin/env node
/**
 * Guards the tbrowse 2.x public surface after the tbrowse-core split.
 *
 *  1. Every name exported by tbrowse 2.10.0 (scripts/exports-2.10.0.txt) is
 *     still exported by dist/index.d.ts (types re-exported forever, functions
 *     re-exported with @deprecated until 3.0).
 *  2. dist/index.d.ts references tbrowse-core as an external dependency
 *     (`from 'tbrowse-core'`) instead of inlining its types — otherwise a
 *     consumer would see two incompatible `Tree` declarations.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dts = readFileSync(resolve(root, 'dist/index.d.ts'), 'utf8');
const frozen = readFileSync(resolve(root, 'scripts/exports-2.10.0.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean);

const names = new Set();
for (const m of dts.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
  for (let n of m[1].split(',')) {
    n = n.trim().replace(/^type\s+/, '');
    if (!n) continue;
    const as = n.split(/\s+as\s+/);
    names.add(as[as.length - 1].trim());
  }
}
for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm)) {
  names.add(m[1]);
}

const missing = frozen.filter((n) => !names.has(n));
const problems = [];
if (missing.length) problems.push(`missing 2.10.0 exports: ${missing.join(', ')}`);
if (!/from ['"]tbrowse-core['"]/.test(dts)) problems.push("dist/index.d.ts does not import from 'tbrowse-core' (types were inlined)");
for (const local of ['interface Tree {', 'interface ViewState {', 'interface HostData {']) {
  if (dts.includes(local)) problems.push(`dist/index.d.ts inlines core type: ${local}`);
}
if (problems.length) {
  console.error('check-exports FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`check-exports OK: ${names.size} exports, all ${frozen.length} 2.10.0 names present, core referenced externally`);
