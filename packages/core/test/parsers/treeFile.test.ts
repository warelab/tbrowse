import { readFileSync } from 'node:fs';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import {
  detectTreeFormat,
  parseTreeFile,
  parseTreeSource,
  type DocumentLike,
} from '../../src/parsers';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/parsers/${name}`, import.meta.url), 'utf8');

const parseDocument = (t: string): DocumentLike =>
  new XmlDomParser({
    onError: (level, msg) => {
      if (level === 'fatalError') throw new Error(msg);
    },
  }).parseFromString(t, 'text/xml') as unknown as DocumentLike;

describe('detectTreeFormat', () => {
  it('detects by content', () => {
    expect(detectTreeFormat(fixture('simple.nwk'))).toBe('newick');
    expect(detectTreeFormat(fixture('translate.nex'))).toBe('nexus');
    expect(detectTreeFormat(fixture('good.xml'))).toBe('phyloxml');
    expect(detectTreeFormat('  <phylogeny><clade/></phylogeny>')).toBe('phyloxml');
    expect(detectTreeFormat('#nexus\nbegin trees; end;')).toBe('nexus');
    expect(detectTreeFormat('(A,B)')).toBe('newick');
    expect(detectTreeFormat('nothing here')).toBeNull();
    expect(detectTreeFormat('')).toBeNull();
  });

  it('falls back to the filename extension only when the content is inconclusive', () => {
    expect(detectTreeFormat('', 'tree.nwk')).toBe('newick');
    expect(detectTreeFormat('', 'TREE.NEWICK')).toBe('newick');
    expect(detectTreeFormat('', 'run.nex')).toBe('nexus');
    expect(detectTreeFormat('', 'out.xml')).toBe('phyloxml');
    expect(detectTreeFormat('', 'notes.txt')).toBeNull();
    expect(detectTreeFormat('', 'noext')).toBeNull();
    // Content wins over the extension.
    expect(detectTreeFormat('#NEXUS\nbegin trees; end;', 'x.nwk')).toBe('nexus');
  });
});

describe('parseTreeFile', () => {
  it('positional filename form dispatches by content and names the file in errors', () => {
    const parsed = parseTreeFile(fixture('simple.nwk'), 'simple.nwk');
    expect(parsed.format).toBe('newick');
    expect(parsed.tree.nodes['A']!.geneId).toBe('A');
    expect(() => parseTreeFile('garbage', 'odd.txt')).toThrow(
      'odd.txt: could not recognize tree format — expected Newick, Nexus, or PhyloXML',
    );
    expect(() => parseTreeFile('garbage')).toThrow(/^tree file: could not recognize/);
  });

  it('options form forwards Newick options and the filename', () => {
    const parsed = parseTreeFile(fixture('simple.nwk'), { filename: 'simple.nwk', leafGeneId: false });
    expect(parsed.tree.nodes['A']!.geneId).toBeUndefined();
    expect(() => parseTreeFile('garbage', { filename: 'odd.txt' })).toThrow(/^odd\.txt:/);
  });

  it('dispatches to Nexus and PhyloXML (with the XML parser from opts)', () => {
    expect(parseTreeFile(fixture('translate.nex')).format).toBe('nexus');
    const xml = parseTreeFile(fixture('good.xml'), { filename: 'good.xml', parseDocument });
    expect(xml.format).toBe('phyloxml');
    expect(xml.taxonomy).toBeDefined();
  });

  it('empty / garbage input throws', () => {
    expect(() => parseTreeFile('')).toThrow();
    expect(() => parseTreeFile('', 'empty.nwk')).toThrow('Newick: empty input');
    expect(() => parseTreeFile('((A,B);', 'bad.nwk')).toThrow(/expected '\)'/);
  });
});

describe('parseTreeSource', () => {
  it('parses a plain string', async () => {
    const parsed = await parseTreeSource('(A,B);');
    expect(parsed.format).toBe('newick');
  });

  it('reads text() from a File-like source and uses its name as the filename', async () => {
    const src = { name: 'odd.txt', text: async () => 'garbage' };
    await expect(parseTreeSource(src)).rejects.toThrow(/^odd\.txt:/);
    const ok = await parseTreeSource({ name: 'tree.nwk', text: async () => fixture('simple.nwk') });
    expect(ok.tree.nodes['B']!.distance).toBe(0.2);
  });

  it('opts.filename overrides the source name and other opts flow through', async () => {
    const src = { name: 'a.txt', text: async () => 'garbage' };
    await expect(parseTreeSource(src, { filename: 'b.txt' })).rejects.toThrow(/^b\.txt:/);
    const parsed = await parseTreeSource({ text: async () => '(A,B);' }, { leafGeneId: false });
    expect(parsed.tree.nodes['A']!.geneId).toBeUndefined();
  });
});
