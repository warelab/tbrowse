#!/usr/bin/env node
/**
 * Generates the API reference under docs/api/ from the BUILT declaration
 * files (dist/<entry>/index.d.ts), one Markdown page per entry point, so
 * the reference can never drift from what `tbrowse-core` actually exports.
 *
 *   npm run docs:api            # rebuild dist, then regenerate docs/api/*.md
 *   node scripts/gen-api-docs.mjs --check
 *                               # exit 1 when docs/api/ differs from what
 *                               # the current dist would generate
 *
 * Every exported symbol of every entry is resolved through the TypeScript
 * checker (aliases followed to their declaration), then rendered as its
 * JSDoc summary plus the declaration text, grouped by kind. Names the root
 * re-exports from a subpath are listed on the root page with a link, so each
 * declaration is rendered once, on the page of the subpath that owns it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '..');
const dist = resolve(pkgDir, 'dist');
const outDir = resolve(pkgDir, 'docs/api');
const check = process.argv.includes('--check');

/** [entry file stem, import specifier, page file, one-line purpose]. Order = page order on the root page. */
const ENTRIES = [
  ['tree', 'tbrowse-core/tree', 'tree.md', 'Children index, walks, roll-ups, pruning, pivot, Newick, hierarchy conversion, swaps, validation.'],
  ['parsers', 'tbrowse-core/parsers', 'parsers.md', 'Newick, Nexus and PhyloXML tree parsers; CSV/TSV table parser.'],
  ['fetch', 'tbrowse-core/fetch', 'fetch.md', 'Retrying fetch, JSON and URL helpers, bounded fan-out.'],
  ['sources', 'tbrowse-core/sources', 'sources.md', 'REST adapters, the TreeDataSource / DataSlot / Loader contract, built-in Ensembl, Gramene, BrAPI and file sources.'],
  ['cluster', 'tbrowse-core/cluster', 'cluster.md', 'UPGMA clustering of genotype dosages.'],
  ['view', 'tbrowse-core/view', 'view.md', 'ViewState construction, normalisation, URL-hash codec, derived prunes, row model.'],
  ['zone', 'tbrowse-core/zone', 'zone.md', 'Row flags, leaf/taxon joins and facet roll-ups for host-defined zones.'],
];
const ROOT = ['index', 'tbrowse-core', 'tbrowse-core.md', 'Everything below, plus the data-model types, the table-zone types and aggregators, and the genotype call encoding.'];

const entryFile = (stem) => (stem === 'index' ? resolve(dist, 'index.d.ts') : resolve(dist, stem, 'index.d.ts'));
for (const [stem] of [ROOT, ...ENTRIES]) {
  if (!existsSync(entryFile(stem))) {
    console.error(`gen-api-docs: ${entryFile(stem)} is missing — run \`npm run build -w packages/core\` first`);
    process.exit(1);
  }
}

const program = ts.createProgram(
  [ROOT, ...ENTRIES].map(([stem]) => entryFile(stem)),
  {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  },
);
const checker = program.getTypeChecker();

const KIND_ORDER = ['Functions', 'Classes', 'Constants', 'Interfaces', 'Type aliases'];

function kindOf(decl) {
  switch (decl.kind) {
    case ts.SyntaxKind.FunctionDeclaration: return 'Functions';
    case ts.SyntaxKind.ClassDeclaration: return 'Classes';
    case ts.SyntaxKind.VariableDeclaration: return 'Constants';
    case ts.SyntaxKind.InterfaceDeclaration: return 'Interfaces';
    case ts.SyntaxKind.TypeAliasDeclaration: return 'Type aliases';
    case ts.SyntaxKind.EnumDeclaration: return 'Constants';
    default: return null;
  }
}

/** Declaration text without the `declare ` / `export ` prefixes, as a consumer would read it in an editor. */
function declText(decl, exportedName) {
  let node = decl;
  if (ts.isVariableDeclaration(decl)) node = decl.parent.parent; // VariableStatement
  let text = node.getText(node.getSourceFile());
  text = text.replace(/^export\s+/, '').replace(/^declare\s+/, '');
  // Chunked builds may declare a symbol under a mangled local name; show the exported one.
  const local = decl.name && ts.isIdentifier(decl.name) ? decl.name.text : null;
  if (local && local !== exportedName) text = text.replace(new RegExp(`\\b${local}\\b`), exportedName);
  return text;
}

/** First sentence of a symbol's JSDoc (the summary), single-spaced; the full text is in the entry below. */
function summaryOf(sym) {
  const doc = ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
  if (!doc) return '';
  const para = doc.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
  // Sentence end = ". " followed by an uppercase letter or a backtick (so "e.g. foo" and "0.5" survive); keep code spans intact.
  const m = /^(.*?[.!?])(?=\s+(?:[A-Z`(]|$))/.exec(para);
  const first = m ? m[1] : para;
  return first.length > 220 ? first.slice(0, 217).replace(/\s+\S*$/, '') + '…' : first;
}

function fullDocOf(sym) {
  return ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
}

function tagsOf(sym) {
  return sym.getJsDocTags(checker).map((t) => ({ name: t.name, text: ts.displayPartsToString(t.text ?? []).trim() }));
}

/** Resolve one module's exports to { name, kind, decls, sym } records, sorted by kind then name. */
function exportsOf(stem) {
  const sf = program.getSourceFile(entryFile(stem));
  const modSym = checker.getSymbolAtLocation(sf);
  if (!modSym) throw new Error(`no module symbol for ${stem}`);
  const out = [];
  for (const sym of checker.getExportsOfModule(modSym)) {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decls = (target.declarations ?? []).filter((d) => kindOf(d) !== null);
    if (decls.length === 0) {
      console.error(`gen-api-docs: ${stem}: no renderable declaration for "${sym.name}"`);
      process.exit(1);
    }
    out.push({ name: sym.name, kind: kindOf(decls[0]), decls, sym: target });
  }
  out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  return out;
}

const anchor = (name) => name.toLowerCase();

function renderEntry(rec) {
  const lines = [`### \`${rec.name}\``, ''];
  const tags = tagsOf(rec.sym);
  const deprecated = tags.find((t) => t.name === 'deprecated');
  if (deprecated) lines.push(`> **Deprecated.** ${deprecated.text}`, '');
  const doc = fullDocOf(rec.sym);
  if (doc) lines.push(doc, '');
  lines.push('```ts');
  for (const d of rec.decls) lines.push(declText(d, rec.name));
  lines.push('```', '');
  return lines.join('\n');
}

function renderPage([stem, spec, , purpose], recs, byName) {
  const lines = [
    `# \`${spec}\``,
    '',
    `<!-- Generated by packages/core/scripts/gen-api-docs.mjs from dist/${stem === 'index' ? '' : stem + '/'}index.d.ts — do not edit; run \`npm run docs:api\`. -->`,
    '',
    purpose,
    '',
  ];
  const counts = KIND_ORDER.map((k) => [k, recs.filter((r) => r.kind === k).length]).filter(([, n]) => n > 0);
  lines.push(`${recs.length} exports: ` + counts.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ') + '.', '');
  if (stem !== 'index') {
    lines.push(
      'Every name here is also exported from the package root (`tbrowse-core`); the subpath import lets a bundler drop the rest.',
      '',
    );
  }
  lines.push('| Name | Kind | Summary |', '|---|---|---|');
  for (const r of recs) {
    const owner = byName.get(r.name);
    const href = owner && owner.stem !== stem ? `./${owner.page}#${anchor(r.name)}` : `#${anchor(r.name)}`;
    lines.push(`| [\`${r.name}\`](${href}) | ${r.kind.replace(/s$/, '').replace('Type aliase', 'Type alias').toLowerCase()} | ${summaryOf(r.sym).replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  for (const kind of KIND_ORDER) {
    const group = recs.filter((r) => r.kind === kind && (!byName.get(r.name) || byName.get(r.name).stem === stem));
    if (group.length === 0) continue;
    lines.push(`## ${kind}`, '');
    for (const r of group) lines.push(renderEntry(r));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Ownership: a name is rendered in full on the first subpath page that exports it; root-only names on the root page.
const byName = new Map();
const pages = new Map();
for (const entry of ENTRIES) {
  const recs = exportsOf(entry[0]);
  for (const r of recs) if (!byName.has(r.name)) byName.set(r.name, { stem: entry[0], page: entry[2] });
  pages.set(entry, recs);
}
const rootRecs = exportsOf(ROOT[0]);

// Root page: the entry-point index, then full entries for root-only names.
function renderRoot() {
  const lines = [
    `# \`tbrowse-core\` API reference`,
    '',
    `<!-- Generated by packages/core/scripts/gen-api-docs.mjs from dist/index.d.ts — do not edit; run \`npm run docs:api\`. -->`,
    '',
    'Generated from the built declaration files; one page per entry point. The root entry exports every name below; the subpaths let a bundler drop what a host does not import.',
    '',
    '| Entry point | Exports | Page | Contents |',
    '|---|---|---|---|',
  ];
  const rootOnly = rootRecs.filter((r) => !byName.has(r.name));
  lines.push(`| \`tbrowse-core\` | ${rootRecs.length} (${rootOnly.length} root-only) | this page | ${ROOT[3]} |`);
  for (const entry of ENTRIES) lines.push(`| \`${entry[1]}\` | ${pages.get(entry).length} | [${entry[2]}](./${entry[2]}) | ${entry[3]} |`);
  lines.push('', '## Root-only exports', '', 'Names exported from `tbrowse-core` but from no subpath: the data-model types, the table-zone types and aggregators (`tbrowse` consumes them), and the genotype call encoding.', '');
  lines.push('| Name | Kind | Summary |', '|---|---|---|');
  for (const r of rootOnly) lines.push(`| [\`${r.name}\`](#${anchor(r.name)}) | ${r.kind.replace(/s$/, '').replace('Type aliase', 'Type alias').toLowerCase()} | ${summaryOf(r.sym).replace(/\|/g, '\\|')} |`);
  lines.push('');
  for (const kind of KIND_ORDER) {
    const group = rootOnly.filter((r) => r.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${kind}`, '');
    for (const r of group) lines.push(renderEntry(r));
  }
  lines.push('## Every root export', '', 'Alphabetical, with the page that documents each name.', '');
  lines.push('| Name | Documented on |', '|---|---|');
  for (const r of [...rootRecs].sort((a, b) => a.name.localeCompare(b.name))) {
    const owner = byName.get(r.name);
    lines.push(`| \`${r.name}\` | ${owner ? `[${owner.stem}](./${owner.page}#${anchor(r.name)})` : `[root](#${anchor(r.name)})`} |`);
  }
  lines.push('');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

const files = new Map();
files.set(ROOT[2], renderRoot());
for (const entry of ENTRIES) files.set(entry[2], renderPage(entry, pages.get(entry), byName));

// Sanity: every root export must be documented somewhere; every subpath export must be a root export.
const rootNames = new Set(rootRecs.map((r) => r.name));
for (const entry of ENTRIES) for (const r of pages.get(entry)) if (!rootNames.has(r.name)) { console.error(`gen-api-docs: ${entry[1]} exports "${r.name}" but the root does not`); process.exit(1); }

/**
 * README "Entry points" table check: every backticked identifier in an entry's
 * row must be an export of that entry, and every runtime export (function,
 * class, constant) of the entry must appear in its row — so the README can be
 * cited as the complete runtime surface. Types are covered by the API pages.
 */
function checkReadmeTable() {
  const readme = readFileSync(resolve(pkgDir, 'README.md'), 'utf8');
  const section = readme.split(/^## Entry points$/m)[1]?.split(/^## /m)[0] ?? '';
  const problems = [];
  const rowFor = (spec) => {
    const m = section.match(new RegExp(`^\\| \`${spec.replace(/\//g, '\\/')}\` \\|(.*)\\|\\s*$`, 'm'));
    return m ? m[1] : null;
  };
  const idents = (row) => new Set([...row.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]));
  const runtime = (recs) => recs.filter((r) => r.kind === 'Functions' || r.kind === 'Classes' || r.kind === 'Constants').map((r) => r.name);
  const rootOnly = rootRecs.filter((r) => !byName.has(r.name));
  const entries = [[ROOT[1], rootRecs, runtime(rootOnly)], ...ENTRIES.map((e) => [e[1], pages.get(e), runtime(pages.get(e))])];
  for (const [spec, recs, required] of entries) {
    const row = rowFor(spec);
    if (row === null) { problems.push(`no README row for \`${spec}\``); continue; }
    const names = idents(row);
    const known = new Set(recs.map((r) => r.name));
    for (const n of names) if (!known.has(n)) problems.push(`README row \`${spec}\` names \`${n}\`, which it does not export`);
    for (const n of required) if (!names.has(n)) problems.push(`README row \`${spec}\` is missing the runtime export \`${n}\``);
  }
  return problems;
}

if (check) {
  const readmeProblems = checkReadmeTable();
  if (readmeProblems.length) { console.error('gen-api-docs --check FAILED (README entry-point table):\n - ' + readmeProblems.join('\n - ')); process.exit(1); }
  const stale = [];
  for (const [name, text] of files) {
    const p = resolve(outDir, name);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== text) stale.push(name);
  }
  if (stale.length) { console.error(`gen-api-docs --check FAILED: out of date: ${stale.join(', ')} — run \`npm run docs:api\``); process.exit(1); }
  console.log(`gen-api-docs --check OK: ${files.size} pages match dist (${rootRecs.length} root exports); README entry-point table complete`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of files) writeFileSync(resolve(outDir, name), text);
  console.log(`gen-api-docs: wrote ${files.size} pages to docs/api (${rootRecs.length} root exports; ` + ENTRIES.map(([s, , , ], i) => `${s} ${pages.get(ENTRIES[i]).length}`).join(', ') + ')');
}
