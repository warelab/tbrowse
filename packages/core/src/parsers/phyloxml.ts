import type { Taxonomy, TaxonomyNode, Tree, TreeNode } from '../types';
import { assertValidTree } from '../tree';
import type { ParsedTreeFile } from './newick';

/**
 * The slice of the DOM `Element` interface the PhyloXML walker needs.
 * Satisfied structurally by browser elements and by `@xmldom/xmldom`
 * elements, so no DOM lib typings are required.
 */
export interface ElementLike {
  localName: string;
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<ElementLike>;
  getAttribute(name: string): string | null;
  getElementsByTagName(tag: string): ArrayLike<ElementLike>;
}

/** The slice of the DOM `Document` interface the PhyloXML parser needs. */
export interface DocumentLike {
  getElementsByTagName(tag: string): ArrayLike<ElementLike>;
}

/** A `DOMParser`-shaped constructor (browser global or `@xmldom/xmldom`). */
export interface DOMParserLike {
  new (): { parseFromString(text: string, type: string): DocumentLike };
}

/** How `parsePhyloXML` obtains an XML document. */
export interface ParsePhyloXMLOptions {
  /** Takes precedence over `DOMParser`: parse the text yourself (lets you
   *  configure xmldom's `onError`, for example). */
  parseDocument?: (text: string) => DocumentLike;
  /** Constructor used when `parseDocument` is absent. Defaults to
   *  `globalThis.DOMParser` (browsers). */
  DOMParser?: DOMParserLike;
}

const ELEMENT_NODE = 1;

/** Every element in document order whose local name is `name`, whatever its namespace prefix. */
function elementsByLocalName(doc: DocumentLike, name: string): ElementLike[] {
  const all = doc.getElementsByTagName('*');
  const out: ElementLike[] = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (el.localName === name) out.push(el);
  }
  return out;
}

const NO_PARSER_MESSAGE =
  'PhyloXML: no XML parser in this environment; pass opts.parseDocument or opts.DOMParser (e.g. @xmldom/xmldom)';

/**
 * Parse a PhyloXML document. Walks the FIRST `<phylogeny>` element that
 * has a root `<clade>`. Supports `<branch_length>` (element or attribute),
 * `<name>`, and the basic `<taxonomy>` block (scientific_name, common_name,
 * rank); each `<taxonomy>` gets a sequential numeric id (1, 2, …) that is
 * stored on the node and in the returned `taxonomy` map. Leaves carry
 * their `<name>` as both id and `geneId`. Other PhyloXML extensions
 * (sequence, events, properties) are ignored.
 *
 * The document comes from `opts.parseDocument`, else `new opts.DOMParser()`,
 * else the global `DOMParser`; when none is available this throws
 * `'PhyloXML: no XML parser in this environment; …'`. A browser-style
 * `<parsererror>` element throws `'PhyloXML: malformed XML — …'`; xmldom
 * instead reports malformed input through its own `onError` handler, so
 * the parser also validates its result and throws
 * `'PhyloXML: no <phylogeny> element'` when no phylogeny with a clade is
 * found. Lifted from `examples/playground/parseTreeFile.ts:250-340`, with
 * `querySelector` / `Element.children` rewritten onto the structural
 * `ElementLike` / `DocumentLike` types.
 */
export function parsePhyloXML(text: string, opts: ParsePhyloXMLOptions = {}): ParsedTreeFile {
  const doc = parseDocumentWith(text, opts);
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) throw new Error(`PhyloXML: malformed XML — ${parserError.textContent ?? ''}`);
  // Match by local name (as the playground's CSS type selector did), so a
  // namespace-prefixed document (`<phy:phylogeny>`) is found too.
  const phylogenies = elementsByLocalName(doc, 'phylogeny');
  let rootClade: ElementLike | null = null;
  for (let i = 0; i < phylogenies.length && rootClade === null; i++) {
    rootClade = directChild(phylogenies[i]!, 'clade');
  }
  if (!rootClade) throw new Error('PhyloXML: no <phylogeny> element');

  const warnings: string[] = [];
  const nodes: Record<string, TreeNode> = {};
  const taxonomy: Taxonomy = {};
  let synthetic = 0;
  const seen = new Set<string>();
  let nextTaxId = 1;

  const walk = (clade: ElementLike, parentId: string | null): string => {
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
      const entry: TaxonomyNode = {
        ...(sci !== undefined ? { scientificName: sci } : {}),
        ...(common !== undefined ? { commonName: common } : {}),
        ...(rank !== undefined ? { rank } : {}),
      };
      taxonomy[tid] = entry;
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
  const tree: Tree = { rootId, nodes };
  assertValidTree(tree);
  return {
    format: 'phyloxml',
    tree,
    ...(Object.keys(taxonomy).length > 0 ? { taxonomy } : {}),
    warnings,
  };
}

function parseDocumentWith(text: string, opts: ParsePhyloXMLOptions): DocumentLike {
  if (opts.parseDocument) return opts.parseDocument(text);
  const Ctor = opts.DOMParser ?? (globalThis as { DOMParser?: DOMParserLike }).DOMParser;
  if (!Ctor) throw new Error(NO_PARSER_MESSAGE);
  return new Ctor().parseFromString(text, 'application/xml');
}

function directChildren(parent: ElementLike, tag: string): ElementLike[] {
  const out: ElementLike[] = [];
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (c.nodeType === ELEMENT_NODE && c.localName === tag) out.push(c);
  }
  return out;
}

function directChild(parent: ElementLike, tag: string): ElementLike | null {
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (c.nodeType === ELEMENT_NODE && c.localName === tag) return c;
  }
  return null;
}
