import { readFileSync } from 'node:fs';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePhyloXML, type DocumentLike, type DOMParserLike } from '../../src/parsers';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/parsers/${name}`, import.meta.url), 'utf8');

/** xmldom reports malformed input through `onError`; make fatal errors throw. */
const parseDocument = (t: string): DocumentLike =>
  new XmlDomParser({
    onError: (level, msg) => {
      if (level === 'fatalError') throw new Error(msg);
    },
  }).parseFromString(t, 'text/xml') as unknown as DocumentLike;

describe('parsePhyloXML (xmldom injected via parseDocument)', () => {
  it('parses a good file: names, branch lengths (element and attribute), taxonomy ids 1,2,...', () => {
    const { format, tree, taxonomy, warnings } = parsePhyloXML(fixture('good.xml'), { parseDocument });
    expect(format).toBe('phyloxml');
    expect(warnings).toEqual([]);
    expect(tree.rootId).toBe('__node_0');
    expect(tree.nodes['geneA']).toMatchObject({
      id: 'geneA',
      geneId: 'geneA',
      isLeaf: true,
      distance: 0.1,
      taxonomyId: 1,
      parentId: '__node_1',
    });
    expect(tree.nodes['geneB']).toMatchObject({ distance: 0.2, taxonomyId: 2 });
    expect(tree.nodes['geneC']).toMatchObject({ distance: 0.5, taxonomyId: 3, parentId: '__node_0' });
    // branch_length given as an attribute on the inner clade.
    expect(tree.nodes['__node_1']).toMatchObject({ isLeaf: false, distance: 0.3, parentId: '__node_0' });
    expect(tree.nodes['__node_1']!.geneId).toBeUndefined();
    expect(taxonomy).toEqual({
      1: { scientificName: 'Homo sapiens', commonName: 'human', rank: 'species' },
      2: { scientificName: 'Pan troglodytes' },
      3: { scientificName: 'Mus musculus', commonName: 'mouse' },
    });
    // No `undefined`-valued keys leak into taxonomy entries.
    expect(Object.keys(taxonomy![2]!)).toEqual(['scientificName']);
  });

  it('omits `taxonomy` when the file has none and warns on duplicate clade names', () => {
    const xml =
      '<phyloxml><phylogeny><clade><clade><name>x</name></clade><clade><name>x</name></clade></clade></phylogeny></phyloxml>';
    const parsed = parsePhyloXML(xml, { parseDocument });
    expect('taxonomy' in parsed).toBe(false);
    // Pre-order walk: the unnamed root is minted first (__node_0), then the duplicate leaf.
    expect(Object.keys(parsed.tree.nodes).sort()).toEqual(['__leaf_1', '__node_0', 'x']);
    expect(parsed.warnings).toEqual(['duplicate clade name "x" — renamed to "__leaf_1"']);
    expect(parsed.tree.nodes['__leaf_1']!.geneId).toBe('x');
  });

  it('throws on malformed XML when the injected parser throws', () => {
    expect(() => parsePhyloXML(fixture('malformed.xml'), { parseDocument })).toThrow();
  });

  it('throws "no <phylogeny> element" on well-formed XML without a phylogeny (or without a clade)', () => {
    expect(() => parsePhyloXML(fixture('no-phylogeny.xml'), { parseDocument })).toThrow(
      'PhyloXML: no <phylogeny> element',
    );
    expect(() => parsePhyloXML('<phyloxml><phylogeny/></phyloxml>', { parseDocument })).toThrow(
      'PhyloXML: no <phylogeny> element',
    );
  });

  it('throws on a browser-style <parsererror> element', () => {
    const doc = parseDocument('<root><parsererror>bad thing</parsererror></root>');
    expect(() => parsePhyloXML('ignored', { parseDocument: () => doc })).toThrow(
      'PhyloXML: malformed XML — bad thing',
    );
  });

  it('accepts a DOMParser constructor via opts.DOMParser', () => {
    const parsed = parsePhyloXML(fixture('good.xml'), {
      DOMParser: XmlDomParser as unknown as DOMParserLike,
    });
    expect(Object.values(parsed.tree.nodes).filter((n) => n.isLeaf)).toHaveLength(3);
  });
});

describe('parsePhyloXML without any XML parser', () => {
  const g = globalThis as { DOMParser?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.DOMParser;
    delete g.DOMParser;
  });
  afterEach(() => {
    if (saved !== undefined) g.DOMParser = saved;
  });

  it('throws the documented message', () => {
    expect(() => parsePhyloXML('<phyloxml/>')).toThrow(
      'PhyloXML: no XML parser in this environment; pass opts.parseDocument or opts.DOMParser (e.g. @xmldom/xmldom)',
    );
  });

  it('falls back to globalThis.DOMParser when present', () => {
    g.DOMParser = XmlDomParser;
    const parsed = parsePhyloXML(fixture('good.xml'));
    expect(parsed.tree.rootId).toBe('__node_0');
  });
});
