import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNexus } from '../../src/parsers';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/parsers/${name}`, import.meta.url), 'utf8');

describe('parseNexus', () => {
  it('resolves TRANSLATE ids to taxon names (quoting names with spaces)', () => {
    const { format, tree, warnings } = parseNexus(fixture('translate.nex'));
    expect(format).toBe('nexus');
    expect(warnings).toEqual([]);
    const leaves = Object.values(tree.nodes).filter((n) => n.isLeaf);
    expect(leaves.map((n) => n.id).sort()).toEqual(['Homo_sapiens', 'Mus musculus', 'Pan_troglodytes']);
    expect(tree.nodes['Homo_sapiens']).toMatchObject({ geneId: 'Homo_sapiens', distance: 0.01 });
    expect(tree.nodes['Mus musculus']!.distance).toBe(0.3);
    // The [&U] comment after `=` is skipped and the bootstrap label survives.
    expect(tree.nodes['0.99']).toMatchObject({ bootstrap: 0.99, distance: 0.1 });
  });

  it('works without a TRANSLATE block and forwards Newick options', () => {
    const text = '#NEXUS\nbegin trees;\n tree t1 = (A:1,B:2);\nend;\n';
    const { tree } = parseNexus(text, { leafGeneId: false });
    expect(Object.keys(tree.nodes).sort()).toEqual(['A', 'B', '__node_0']);
    expect(tree.nodes['A']!.geneId).toBeUndefined();
  });

  it('throws on a missing header, missing TREES block, or missing tree statement', () => {
    expect(() => parseNexus('begin trees; tree t = (A,B); end;')).toThrow('missing #NEXUS header');
    expect(() => parseNexus('#NEXUS\nbegin taxa; end;')).toThrow('no TREES block');
    expect(() => parseNexus('#NEXUS\nbegin trees;\nend;')).toThrow('no `tree NAME = ...;` line');
  });
});
