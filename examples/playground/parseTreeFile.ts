import type { Taxonomy, Tree, TreeNode } from 'tbrowse';

export type TreeFileFormat = 'newick' | 'nexus' | 'phyloxml';

export interface ParsedTreeFile {
  format: TreeFileFormat;
  tree: Tree;
  /** Optional taxonomy mined from the file (PhyloXML only for now). */
  taxonomy?: Taxonomy;
  /** Soft validation messages — empty when everything looks healthy. */
  warnings: string[];
}

/**
 * Sniff the file's content to decide which parser to dispatch to. The
 * detector deliberately runs before stripping anything because the
 * marker tokens (#NEXUS, <phyloxml>, etc.) only appear in their
 * respective formats. Falls back to Newick when nothing matches but
 * the body has at least one parenthesis — many genuine Newick files
 * skip the trailing semicolon, omit any header, and just start with
 * `(`.
 */
function detectFormat(text: string): TreeFileFormat | null {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<?xml') || head.includes('<phyloxml') || head.includes('<phylogeny')) {
    return 'phyloxml';
  }
  if (head.startsWith('#nexus')) return 'nexus';
  if (text.includes('(')) return 'newick';
  return null;
}

export function parseTreeFile(text: string, filename?: string): ParsedTreeFile {
  const format = detectFormat(text);
  if (format === null) {
    throw new Error(
      `${filename ?? 'tree file'}: could not recognize tree format — expected Newick, Nexus, or PhyloXML`,
    );
  }
  if (format === 'phyloxml') return parsePhyloXML(text);
  if (format === 'nexus') return parseNexus(text);
  return parseNewick(text);
}

// ─── Newick ───────────────────────────────────────────────────────────

/**
 * Parse a single Newick tree string. Supports:
 *   - Quoted leaf names ('with spaces / commas')
 *   - Comments in square brackets, stripped before parsing
 *   - Branch lengths in scientific notation
 *   - Internal-node labels (used as the node id when present)
 *   - Bootstrap values written as the internal-node label or after the
 *     branch length (`)0.95:0.1`); both encodings flow into `bootstrap`.
 *
 * Generates synthetic ids for internal nodes that lack a label and for
 * leaves that share a label — `Tree.nodes` requires unique keys.
 */
export function parseNewick(text: string): ParsedTreeFile {
  const warnings: string[] = [];
  // Drop comments and any trailing semicolons + whitespace.
  const cleaned = text.replace(/\[[^\]]*\]/g, '');
  const body = cleaned.trim().replace(/;\s*$/, '').trim();
  if (body.length === 0) throw new Error('Newick: empty input');

  const nodes: Record<string, TreeNode> = {};
  let pos = 0;
  let synthetic = 0;
  const seenIds = new Set<string>();

  const uniqueId = (raw: string, isLeaf: boolean): string => {
    const base = raw.trim();
    if (base !== '' && !seenIds.has(base)) {
      seenIds.add(base);
      return base;
    }
    if (base !== '') {
      // Duplicate leaf / internal label — keep the original spelling on
      // the node and disambiguate the id with a numeric suffix.
      let n = 2;
      let candidate = `${base}__${n}`;
      while (seenIds.has(candidate)) {
        n++;
        candidate = `${base}__${n}`;
      }
      seenIds.add(candidate);
      warnings.push(`duplicate ${isLeaf ? 'leaf' : 'internal'} label "${base}" — renamed to "${candidate}"`);
      return candidate;
    }
    let candidate = `__${isLeaf ? 'leaf' : 'node'}_${synthetic++}`;
    while (seenIds.has(candidate)) {
      candidate = `__${isLeaf ? 'leaf' : 'node'}_${synthetic++}`;
    }
    seenIds.add(candidate);
    return candidate;
  };

  // Read a token (leaf name, internal label, or branch length number).
  // Honours single-quoted strings ('embedded, commas/parens') by
  // returning the unquoted contents.
  const readToken = (): string => {
    if (body[pos] === "'") {
      pos++;
      let out = '';
      while (pos < body.length) {
        if (body[pos] === "'") {
          if (body[pos + 1] === "'") {
            out += "'";
            pos += 2;
            continue;
          }
          pos++;
          return out;
        }
        out += body[pos++];
      }
      throw new Error('Newick: unterminated quoted name');
    }
    let out = '';
    while (pos < body.length && !',():;'.includes(body[pos])) {
      out += body[pos++];
    }
    return out.trim();
  };

  const parseSubtree = (): string => {
    let childIds: string[] = [];
    if (body[pos] === '(') {
      pos++;
      childIds.push(parseSubtree());
      while (body[pos] === ',') {
        pos++;
        childIds.push(parseSubtree());
      }
      if (body[pos] !== ')') {
        throw new Error(
          `Newick: expected ')' at position ${pos}, found '${body[pos] ?? '<eof>'}'`,
        );
      }
      pos++;
    }
    const isLeaf = childIds.length === 0;
    // Optional name / internal label.
    const label = readToken();
    // Optional branch length and embedded bootstrap.
    let distance = 0;
    let bootstrap: number | undefined;
    if (body[pos] === ':') {
      pos++;
      const lenTok = readToken();
      const len = Number(lenTok);
      if (Number.isFinite(len) && len >= 0) distance = len;
      else if (lenTok !== '') warnings.push(`invalid branch length "${lenTok}"`);
    }
    // Internal-node label that parses as a number is treated as
    // bootstrap support; the literal label still becomes the node id.
    if (!isLeaf && label !== '' && Number.isFinite(Number(label))) {
      const n = Number(label);
      if (n >= 0 && n <= 100) bootstrap = n;
    }
    const id = uniqueId(label, isLeaf);
    const node: TreeNode = {
      id,
      parentId: null,
      distance,
      isLeaf,
    };
    if (isLeaf && label !== '') node.geneId = label;
    if (bootstrap !== undefined) node.bootstrap = bootstrap;
    nodes[id] = node;
    for (const cid of childIds) {
      const child = nodes[cid];
      if (child) child.parentId = id;
    }
    return id;
  };

  const rootId = parseSubtree();
  if (pos < body.length) {
    warnings.push(`trailing content at position ${pos}: ${body.slice(pos, pos + 30)}…`);
  }
  validateTree(rootId, nodes);
  return { format: 'newick', tree: { rootId, nodes }, warnings };
}

function validateTree(rootId: string, nodes: Record<string, TreeNode>) {
  if (!nodes[rootId]) throw new Error('parsed tree has no root');
  let leafCount = 0;
  for (const n of Object.values(nodes)) {
    if (n.isLeaf) leafCount++;
  }
  if (leafCount === 0) throw new Error('parsed tree has no leaves');
}

// ─── Nexus ────────────────────────────────────────────────────────────

/**
 * Parse a Nexus file by extracting the first tree from a TREES block
 * and feeding it to the Newick parser. Honours TRANSLATE blocks that
 * map shorthand integers back to taxon names — common in MrBayes /
 * BEAST / RAxML output.
 */
export function parseNexus(text: string): ParsedTreeFile {
  const head = text.match(/#nexus/i);
  if (!head) throw new Error('Nexus: missing #NEXUS header');
  const treesMatch = text.match(/begin\s+trees\s*;([\s\S]*?)end\s*;/i);
  if (!treesMatch) throw new Error('Nexus: no TREES block found');
  const block = treesMatch[1];
  // TRANSLATE mapping (optional): `translate <id1> <name1>, <id2> <name2>, ...;`
  const translate: Record<string, string> = {};
  const transMatch = block.match(/translate\s+([\s\S]*?);/i);
  if (transMatch) {
    const pairs = transMatch[1]
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const p of pairs) {
      // First whitespace-separated token is the id, rest is the name.
      const m = p.match(/^(\S+)\s+(.+)$/);
      if (m) translate[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const treeMatch = block.match(/tree\s+\S+\s*=(?:\s*\[[^\]]*\])?\s*([\s\S]*?);/i);
  if (!treeMatch) throw new Error('Nexus: no `tree NAME = ...;` line found in TREES block');
  let newick = treeMatch[1].trim() + ';';
  // Substitute translated ids with their full names. Done BEFORE
  // parsing so the Newick parser sees the resolved labels.
  if (Object.keys(translate).length > 0) {
    newick = newick.replace(/([(,])\s*(\w+)/g, (full, sep, tok) =>
      translate[tok] ? `${sep}${quoteIfNeeded(translate[tok])}` : full,
    );
  }
  const inner = parseNewick(newick);
  return { ...inner, format: 'nexus' };
}

function quoteIfNeeded(s: string): string {
  return /[\s,():;]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

// ─── PhyloXML ─────────────────────────────────────────────────────────

/**
 * Parse a PhyloXML document. Walks the FIRST `<phylogeny>` element's
 * `<clade>` tree. Supports `<branch_length>`, `<name>`, and the basic
 * `<taxonomy>` block (scientific_name + common_name); leaves carry
 * their `<name>` as both id and `geneId`. Other PhyloXML extensions
 * (sequence, events, properties) are ignored.
 */
export function parsePhyloXML(text: string): ParsedTreeFile {
  if (typeof DOMParser === 'undefined') {
    throw new Error('PhyloXML: DOMParser is unavailable in this environment');
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error(`PhyloXML: malformed XML — ${parserError.textContent ?? ''}`);
  const phylogeny = doc.querySelector('phylogeny');
  if (!phylogeny) throw new Error('PhyloXML: no <phylogeny> element');
  const rootClade = directChild(phylogeny, 'clade');
  if (!rootClade) throw new Error('PhyloXML: <phylogeny> has no root <clade>');

  const warnings: string[] = [];
  const nodes: Record<string, TreeNode> = {};
  const taxonomy: Taxonomy = {};
  let synthetic = 0;
  const seen = new Set<string>();
  let nextTaxId = 1;

  const walk = (clade: Element, parentId: string | null): string => {
    const childClades = directChildren(clade, 'clade');
    const isLeaf = childClades.length === 0;
    const nameEl = directChild(clade, 'name');
    const rawName = nameEl?.textContent?.trim() ?? '';
    let id = rawName;
    if (id === '' || seen.has(id)) {
      const fallback = `__${isLeaf ? 'leaf' : 'node'}_${synthetic++}`;
      if (rawName !== '' && id !== '') {
        warnings.push(`duplicate clade name "${rawName}" — renamed to "${fallback}"`);
      }
      id = fallback;
    }
    seen.add(id);

    const branchEl = directChild(clade, 'branch_length');
    const branchAttr = clade.getAttribute('branch_length');
    const distRaw = branchEl?.textContent ?? branchAttr ?? '';
    const distance = Number.isFinite(Number(distRaw)) ? Number(distRaw) : 0;

    let taxonomyId: number | undefined;
    const taxEl = directChild(clade, 'taxonomy');
    if (taxEl) {
      const tid = nextTaxId++;
      taxonomyId = tid;
      const sci = directChild(taxEl, 'scientific_name')?.textContent?.trim();
      const common = directChild(taxEl, 'common_name')?.textContent?.trim();
      const rank = directChild(taxEl, 'rank')?.textContent?.trim();
      taxonomy[tid] = {
        scientificName: sci,
        commonName: common,
        rank,
      };
    }

    const node: TreeNode = {
      id,
      parentId,
      distance,
      isLeaf,
    };
    if (isLeaf && rawName !== '') node.geneId = rawName;
    if (taxonomyId !== undefined) node.taxonomyId = taxonomyId;

    nodes[id] = node;
    for (const child of childClades) walk(child, id);
    return id;
  };

  const rootId = walk(rootClade, null);
  validateTree(rootId, nodes);
  return {
    format: 'phyloxml',
    tree: { rootId, nodes },
    taxonomy: Object.keys(taxonomy).length > 0 ? taxonomy : undefined,
    warnings,
  };
}

function directChildren(parent: Element, tag: string): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(parent.children)) {
    if (c.localName === tag) out.push(c);
  }
  return out;
}
function directChild(parent: Element, tag: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (c.localName === tag) return c;
  }
  return null;
}
