import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { parsePhyloXML, type DocumentLike } from '../../src/parsers';
import { leafIdsOf } from '../../src/tree';

const parseDocument = (t: string): DocumentLike =>
  new XmlDomParser({ onError: (level, msg) => { if (level === 'fatalError') throw new Error(String(msg)); } })
    .parseFromString(t, 'text/xml') as unknown as DocumentLike;

describe('parsePhyloXML with a namespace prefix', () => {
  it('finds <phy:phylogeny> by local name, as the playground did with querySelector', () => {
    const text = readFileSync(resolve(__dirname, '../fixtures/parsers/namespaced.xml'), 'utf8');
    const parsed = parsePhyloXML(text, { parseDocument });
    expect(parsed.format).toBe('phyloxml');
    expect(leafIdsOf(parsed.tree)).toEqual(['A', 'B']);
    expect(parsed.tree.nodes['B']?.distance).toBeCloseTo(0.2);
  });
});
