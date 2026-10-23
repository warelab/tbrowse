import { parseNewick, type ParseNewickOptions, type ParsedTreeFile, type TreeFileFormat } from './newick';
import { parseNexus } from './nexus';
import { parsePhyloXML, type ParsePhyloXMLOptions } from './phyloxml';

/** Options for `parseTreeFile` / `parseTreeSource`: the Newick and
 *  PhyloXML options plus the filename used in error messages and as a
 *  format hint. */
export interface ParseTreeFileOptions extends ParseNewickOptions, ParsePhyloXMLOptions {
  filename?: string;
}

const EXTENSION_FORMATS: Record<string, TreeFileFormat> = {
  nwk: 'newick',
  newick: 'newick',
  tree: 'newick',
  tre: 'newick',
  nex: 'nexus',
  nexus: 'nexus',
  nxs: 'nexus',
  xml: 'phyloxml',
  phyloxml: 'phyloxml',
};

/**
 * Sniff the file's content to decide which parser to dispatch to. The
 * detector deliberately runs before stripping anything because the
 * marker tokens (#NEXUS, <phyloxml>, etc.) only appear in their
 * respective formats. Falls back to Newick when nothing matches but
 * the body has at least one parenthesis — many genuine Newick files
 * skip the trailing semicolon, omit any header, and just start with
 * `(`. When the content is inconclusive and a `filename` is given, its
 * extension (`.nwk/.newick/.tree/.tre`, `.nex/.nexus/.nxs`,
 * `.xml/.phyloxml`) decides; otherwise returns null. Lifted from
 * `examples/playground/parseTreeFile.ts:23-31` (content rules unchanged;
 * the extension fallback is new).
 */
export function detectTreeFormat(text: string, filename?: string): TreeFileFormat | null {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith('<?xml') || head.includes('<phyloxml') || head.includes('<phylogeny')) {
    return 'phyloxml';
  }
  if (head.startsWith('#nexus')) return 'nexus';
  if (text.includes('(')) return 'newick';
  if (filename !== undefined) {
    const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (ext !== undefined) return EXTENSION_FORMATS[ext] ?? null;
  }
  return null;
}

/**
 * Parse a tree file of any supported format, detected by
 * `detectTreeFormat`. Accepts the filename positionally
 * (`parseTreeFile(text, 'tree.nwk')`, the playground's call shape) or as
 * `opts.filename` alongside the Newick / PhyloXML options, which are
 * forwarded to the matching parser. Throws when no format is recognised
 * or when the chosen parser rejects the input. Lifted from
 * `examples/playground/parseTreeFile.ts:33-43`.
 */
export function parseTreeFile(
  text: string,
  filenameOrOpts?: string | ParseTreeFileOptions,
): ParsedTreeFile {
  const opts: ParseTreeFileOptions =
    typeof filenameOrOpts === 'string' ? { filename: filenameOrOpts } : filenameOrOpts ?? {};
  const format = detectTreeFormat(text, opts.filename);
  if (format === null) {
    throw new Error(
      `${opts.filename ?? 'tree file'}: could not recognize tree format — expected Newick, Nexus, or PhyloXML`,
    );
  }
  if (format === 'phyloxml') return parsePhyloXML(text, opts);
  if (format === 'nexus') return parseNexus(text, opts);
  return parseNewick(text, opts);
}

/**
 * Async convenience over `parseTreeFile` for things that hand out text
 * lazily: a `File` / `Blob` from a drop zone, a `fetch` `Response`, or
 * any object with `text()`. A plain string is parsed directly. When the
 * source has a `name` (as `File` does) it becomes the filename unless
 * `opts.filename` is set.
 */
export async function parseTreeSource(
  src: string | { text(): Promise<string>; name?: string },
  opts: ParseTreeFileOptions = {},
): Promise<ParsedTreeFile> {
  if (typeof src === 'string') return parseTreeFile(src, opts);
  const text = await src.text();
  const filename = opts.filename ?? src.name;
  return parseTreeFile(text, { ...opts, ...(filename !== undefined ? { filename } : {}) });
}
