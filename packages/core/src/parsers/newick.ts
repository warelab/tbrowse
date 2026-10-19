import type { Taxonomy, Tree, TreeNode } from '../types';
import { assertValidTree } from '../tree';

/** File formats the tree parsers understand. */
export type TreeFileFormat = 'newick' | 'nexus' | 'phyloxml';

/** Result shared by every tree parser in this module. */
export interface ParsedTreeFile {
  format: TreeFileFormat;
  tree: Tree;
  /** Optional taxonomy mined from the file (PhyloXML only for now). */
  taxonomy?: Taxonomy;
  /** Soft validation messages — empty when everything looks healthy. */
  warnings: string[];
}

/** Options shared by the Newick and Nexus parsers. */
export interface ParseNewickOptions {
  /**
   * When true (the default) a leaf's label becomes its `geneId` as well as
   * its `id`, which is what the playground and the BrAPI adapter expect.
   * Set to false to keep labels as ids only.
   */
  leafGeneId?: boolean;
  /**
   * Prefix prepended to the synthetic ids minted for unlabelled nodes
   * (`__leaf_N` / `__node_N`), e.g. `idPrefix: 't1'` yields `t1__node_0`.
   * Labelled nodes keep their label as id. Defaults to no prefix.
   */
  idPrefix?: string;
}

/**
 * Parse a single Newick tree string into a flat `Tree`. Supports:
 *   - Quoted leaf names ('with spaces / commas', doubled '' escapes)
 *   - Comments in square brackets, stripped before parsing
 *   - Branch lengths in scientific notation
 *   - Internal-node labels (used as the node id when present)
 *   - Bootstrap values written as a numeric internal-node label in 0–100
 *     (`)95:0.1`); the literal label still becomes the node id.
 *
 * Generates synthetic ids for internal nodes that lack a label and for
 * leaves that share a label — `Tree.nodes` requires unique keys; the
 * duplicate gets a `__2`, `__3`, … suffix and a warning. Throws on empty
 * input, unbalanced parentheses, unterminated quotes, or when the result
 * fails `assertValidTree`. Lifted from
 * `examples/playground/parseTreeFile.ts:59-185`; with no `opts` the
 * behaviour is identical to the playground.
 */
export function parseNewick(text: string, opts: ParseNewickOptions = {}): ParsedTreeFile {
  const leafGeneId = opts.leafGeneId ?? true;
  const prefix = opts.idPrefix ?? '';
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
    let candidate = `${prefix}__${isLeaf ? 'leaf' : 'node'}_${synthetic++}`;
    while (seenIds.has(candidate)) {
      candidate = `${prefix}__${isLeaf ? 'leaf' : 'node'}_${synthetic++}`;
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
    while (pos < body.length && !',():;'.includes(body[pos]!)) {
      out += body[pos++];
    }
    return out.trim();
  };

  const parseSubtree = (): string => {
    const childIds: string[] = [];
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
    if (isLeaf && label !== '' && leafGeneId) node.geneId = label;
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
  const tree: Tree = { rootId, nodes };
  assertValidTree(tree);
  return { format: 'newick', tree, warnings };
}

/**
 * Parse a multi-tree Newick file (one tree per `;`-terminated statement,
 * as written by RAxML bootstrap runs, MrBayes `.t` files, or `cat`-ed
 * tree sets). Statements are split on semicolons that sit outside quoted
 * labels and `[comments]`; blank statements are skipped and each remaining
 * one goes through `parseNewick` with the same `opts`, so a malformed
 * tree anywhere in the file throws. Returns `[]` for whitespace-only
 * input.
 */
export function parseNewickAll(text: string, opts: ParseNewickOptions = {}): ParsedTreeFile[] {
  const chunks: string[] = [];
  let cur = '';
  let inQuote = false;
  let commentDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuote) {
      cur += c;
      if (c === "'") inQuote = false;
      continue;
    }
    if (commentDepth > 0) {
      cur += c;
      if (c === ']') commentDepth--;
      continue;
    }
    if (c === "'") {
      inQuote = true;
      cur += c;
    } else if (c === '[') {
      commentDepth++;
      cur += c;
    } else if (c === ';') {
      chunks.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  chunks.push(cur);
  const out: ParsedTreeFile[] = [];
  for (const chunk of chunks) {
    const stripped = chunk.replace(/\[[^\]]*\]/g, '').trim();
    if (stripped.length === 0) continue;
    out.push(parseNewick(chunk, opts));
  }
  return out;
}
