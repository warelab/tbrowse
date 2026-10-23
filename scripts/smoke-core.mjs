#!/usr/bin/env node
/**
 * Packaging smoke test for tbrowse-core: pack the workspace package, install
 * the tarball into an empty project WITHOUT tbrowse or react, load the root and
 * every subpath from both CommonJS and ESM, and grep the shipped JS for things
 * a headless package must never contain. Prints the tarball size.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUBPATHS = ['', 'tree', 'parsers', 'cluster', 'fetch', 'sources', 'view', 'zone'];
const tmp = mkdtempSync(join(tmpdir(), 'tbrowse-core-smoke-'));
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' }).toString();
try {
  run(`npm pack -w packages/core --pack-destination "${tmp}" --silent`, root);
  const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack produced no tarball');
  const size = statSync(join(tmp, tgz)).size;
  const proj = join(tmp, 'proj');
  execSync(`mkdir -p "${proj}"`);
  writeFileSync(join(proj, 'package.json'), '{"name":"smoke","private":true}\n');
  run(`npm install --no-audit --no-fund --ignore-scripts "${join(tmp, tgz)}"`, proj);
  const spec = (s) => (s ? `tbrowse-core/${s}` : 'tbrowse-core');
  run(`node -e "${SUBPATHS.map((s) => `require('${spec(s)}');`).join(' ')} console.log('cjs ok')"`, proj);
  run(`node --input-type=module -e "${SUBPATHS.map((s) => `import '${spec(s)}';`).join(' ')} console.log('esm ok')"`, proj);
  // identity across subpaths (guards tsup splitting): HttpError from /fetch === HttpError from root
  run(`node -e "const a=require('tbrowse-core/fetch').HttpError, b=require('tbrowse-core').HttpError; if(a!==b) throw new Error('HttpError identity differs between subpaths (cjs)')"`, proj);
  run(`node --input-type=module -e "import {HttpError as a} from 'tbrowse-core/fetch'; import {HttpError as b} from 'tbrowse-core'; if(a!==b) throw new Error('HttpError identity differs between subpaths (esm)')"`, proj);
  const dist = join(proj, 'node_modules/tbrowse-core/dist');
  const bad = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|cjs)$/.test(f)) {
    const s = readFileSync(p, 'utf8');
    for (const re of [/from\s*['"]tbrowse['"]/, /require\(['"]tbrowse['"]\)/, /from\s*['"]react['"]/, /require\(['"]react['"]\)/, /\bwindow\.[A-Za-z]/, /\bdocument\.[A-Za-z]/, /new DOMParser\(/]) {
      if (re.test(s)) bad.push(`${p.slice(dist.length + 1)} matches ${re}`);
    }
  } } };
  walk(dist);
  if (bad.length) throw new Error('forbidden references in dist:\n - ' + bad.join('\n - '));
  console.log(`smoke-core OK: ${tgz} (${(size / 1024).toFixed(1)} kB), cjs+esm root and ${SUBPATHS.length - 1} subpaths load, no react/tbrowse/DOM references`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
