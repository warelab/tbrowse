/**
 * A `TreeDataSource` over a tree file (Newick, Nexus or PhyloXML) handed
 * in as text or as anything with `text()` — a `File` from a drop zone, a
 * `fetch` `Response`. Origin: the playground's `handleUploadedTree`
 * (`examples/playground/main.tsx:735-760`), which parsed the file with
 * `parseTreeFile(text, file.name)` and surfaced `warnings` as a status line.
 */

import { parseTreeSource, type ParsePhyloXMLOptions, type TreeFileFormat } from '../parsers/index';
import type { TreeDataSource } from './types';

/** Context for {@link fileTreeSource}. */
export interface FileTreeCtx extends ParsePhyloXMLOptions {
  /** The file contents, or an object that yields them (`File`, `Response`, …); its `name` becomes the filename. */
  file: string | { text(): Promise<string>; name?: string };
}

/** Root metadata of {@link fileTreeSource}. */
export interface FileTreeMeta {
  /** The format `detectTreeFormat` recognised. */
  format: TreeFileFormat;
  /** `ctx.file.name`, when the source had one. */
  filename?: string;
  /** Soft validation messages from the parser (duplicate labels, trailing junk, …). */
  warnings: string[];
}

/**
 * The file data source: the root is `parseTreeSource(ctx.file, …)` — the
 * format is sniffed from the content (then from the filename extension),
 * the PhyloXML parser takes `ctx.parseDocument` / `ctx.DOMParser` by
 * injection, and a PhyloXML taxonomy is passed through. Parse errors
 * reject the root load; soft warnings land in `meta.warnings`. No slots:
 * tables that accompany a tree are parsed by the host (`parseTableFile`).
 */
export const fileTreeSource: TreeDataSource<FileTreeCtx, FileTreeMeta> = {
  id: 'file',
  label: 'Tree file',
  async loadRoot({ ctx }) {
    const parsed = await parseTreeSource(ctx.file, {
      ...(ctx.parseDocument !== undefined ? { parseDocument: ctx.parseDocument } : {}),
      ...(ctx.DOMParser !== undefined ? { DOMParser: ctx.DOMParser } : {}),
    });
    const filename = typeof ctx.file === 'string' ? undefined : ctx.file.name;
    const meta: FileTreeMeta = { format: parsed.format, warnings: parsed.warnings };
    if (filename !== undefined) meta.filename = filename;
    return {
      tree: parsed.tree,
      ...(parsed.taxonomy !== undefined ? { taxonomy: parsed.taxonomy } : {}),
      meta,
    };
  },
  slots: [],
};
