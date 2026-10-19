import { describe, expect, it } from 'vitest';
import { fileTreeSource, type FileTreeCtx } from '../../src/sources/file';
import type { FetchLike } from '../../src/fetch/index';

const NEWICK = '((A:0.1,B:0.2)n1:0.3,C:0.4);';
const NEXUS = '#NEXUS\nBEGIN TREES;\n  TREE t1 = ((A:0.1,B:0.2),C:0.4);\nEND;\n';

/** The source makes no requests; a rejecting transport proves it. */
const noFetch: FetchLike = async (url) => {
  throw new Error(`unexpected request: ${url}`);
};
const rootCtx = (ctx: FileTreeCtx) => ({ ctx, fetch: noFetch, signal: new AbortController().signal });

describe('fileTreeSource', () => {
  it('parses a Newick string: tree, format, warnings, no filename, no slots', async () => {
    const root = await fileTreeSource.loadRoot(rootCtx({ file: NEWICK }));
    expect(fileTreeSource.id).toBe('file');
    expect(fileTreeSource.slots).toEqual([]);
    expect(root.meta).toEqual({ format: 'newick', warnings: [] });
    expect(root.taxonomy).toBeUndefined();
    expect(root.nodeOfInterest).toBeUndefined();
    const leaves = Object.values(root.tree.nodes).filter((n) => n.isLeaf);
    expect(leaves.map((n) => n.geneId).sort()).toEqual(['A', 'B', 'C']);
  });

  it('reads a { text(), name } source lazily and records the filename', async () => {
    let reads = 0;
    const file = {
      name: 'sample.nex',
      text: async () => {
        reads++;
        return NEXUS;
      },
    };
    const root = await fileTreeSource.loadRoot(rootCtx({ file }));
    expect(reads).toBe(1);
    expect(root.meta).toEqual({ format: 'nexus', filename: 'sample.nex', warnings: [] });
    expect(Object.values(root.tree.nodes).filter((n) => n.isLeaf)).toHaveLength(3);
  });

  it('a { text() } source without a name yields no filename', async () => {
    const root = await fileTreeSource.loadRoot(rootCtx({ file: { text: async () => NEWICK } }));
    expect(root.meta).toEqual({ format: 'newick', warnings: [] });
  });

  it('passes parser warnings through meta and rejects on unparseable input', async () => {
    const dup = await fileTreeSource.loadRoot(rootCtx({ file: '((A,A),B);' }));
    expect(dup.meta.warnings.length).toBeGreaterThan(0);
    await expect(fileTreeSource.loadRoot(rootCtx({ file: { name: 'notes.txt', text: async () => 'hello' } }))).rejects.toThrow(
      /notes\.txt: could not recognize tree format/,
    );
  });

  it('hands parseDocument to the PhyloXML parser', async () => {
    const xml = '<?xml version="1.0"?><phyloxml><phylogeny><clade><name>root</name><clade><name>A</name></clade><clade><name>B</name></clade></clade></phylogeny></phyloxml>';
    let called = 0;
    const parseDocument = (text: string) => {
      called++;
      // Deliberately a stub: the test checks injection, not XML parsing,
      // so hand back an element-less document and expect the parser to
      // complain about the missing phylogeny rather than about the
      // missing DOMParser.
      void text;
      return { getElementsByTagName: () => [] as never[], documentElement: null } as never;
    };
    await expect(fileTreeSource.loadRoot(rootCtx({ file: xml, parseDocument }))).rejects.not.toThrow(/no XML parser/);
    expect(called).toBe(1);
  });
});
