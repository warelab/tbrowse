#!/usr/bin/env node
/**
 * Every name the tbrowse viewer imports from tbrowse-core (listed in
 * scripts/surface-used-by-tbrowse.txt, regenerated from `grep` over
 * tbrowse/src) must be exported by the built dist/index.d.ts. Core 0.x/1.x
 * minors must keep this surface so the ">=0.1.0 <2.0.0" range tbrowse
 * declares stays valid for already-installed viewers.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dts = readFileSync(resolve(here, '../dist/index.d.ts'), 'utf8');
const wanted = readFileSync(resolve(here, 'surface-used-by-tbrowse.txt'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const names = new Set();
for (const m of dts.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (let n of m[1].split(',')) { n = n.trim().replace(/^type\s+/, ''); if (!n) continue; const as = n.split(/\s+as\s+/); names.add(as[as.length - 1].trim()); }
for (const m of dts.matchAll(/^export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
const missing = wanted.filter((n) => !names.has(n));
if (missing.length) { console.error('check-surface FAILED, missing: ' + missing.join(', ')); process.exit(1); }
console.log(`check-surface OK: ${wanted.length} names used by tbrowse are exported`);
