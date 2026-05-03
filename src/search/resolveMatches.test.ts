import { describe, expect, it } from 'vitest';
import type { HostData, Tree } from '../types';
import { SEARCH_MATCH_LIMIT } from '../types';
import { BUILTIN_SEARCH_FIELDS } from './fields';
import { resolveMatches } from './resolveMatches';

// Compact binary tree for matching tests:
//
//   n0
//   ├── n1
//   │   ├── n3 (leaf, geneId BRCA2_HUMAN, taxId 9606)
//   │   └── n4 (leaf, geneId BRCA2_CHIMP, taxId 9598)
//   └── n2
//       ├── n5 (leaf, geneId AT1G01010,   taxId 3702)
//       └── n6 (leaf, geneId AT1G01020,   taxId 3702)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: false },
    n3: {
      id: 'n3',
      parentId: 'n1',
      distance: 1,
      isLeaf: true,
      geneId: 'BRCA2_HUMAN',
      taxonomyId: 9606,
    },
    n4: {
      id: 'n4',
      parentId: 'n1',
      distance: 1,
      isLeaf: true,
      geneId: 'BRCA2_CHIMP',
      taxonomyId: 9598,
    },
    n5: {
      id: 'n5',
      parentId: 'n2',
      distance: 1,
      isLeaf: true,
      geneId: 'AT1G01010',
      taxonomyId: 3702,
    },
    n6: {
      id: 'n6',
      parentId: 'n2',
      distance: 1,
      isLeaf: true,
      geneId: 'AT1G01020',
      taxonomyId: 3702,
    },
  },
};

const data: HostData = {
  tree,
  taxonomy: {
    9606: { scientificName: 'Homo sapiens', commonName: 'human' },
    9598: { scientificName: 'Pan troglodytes', commonName: 'chimpanzee' },
    3702: { scientificName: 'Arabidopsis thaliana', commonName: 'thale cress' },
  },
  geneMetadata: {
    BRCA2_HUMAN: {
      displayName: 'BRCA2',
      description: 'Breast cancer type 2 susceptibility protein',
    },
    BRCA2_CHIMP: {
      displayName: 'BRCA2',
      description: 'Breast cancer type 2 susceptibility protein',
    },
    AT1G01010: {
      displayName: 'NAC001',
      description: 'NAC domain transcription factor',
    },
    AT1G01020: {
      displayName: 'ARV1',
      description: 'ARV1-like protein',
    },
  },
};

const noPrune = new Set<string>();

describe('resolveMatches', () => {
  it('returns empty results when search is null or query is empty', () => {
    const r1 = resolveMatches(data, null, BUILTIN_SEARCH_FIELDS, noPrune);
    expect(r1.matchedLeafIds.size).toBe(0);
    const r2 = resolveMatches(
      data,
      { query: '' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(r2.matchedLeafIds.size).toBe(0);
  });

  it('searches every field by default — gene-id, taxonomy, node-id all match', () => {
    // "n3" is a node id (matches node-id field), and is also a substring
    // of "AT1G01010"? No — but it matches the leaf node-id "n3" exactly.
    const r = resolveMatches(
      data,
      { query: 'n3' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    // n3 matches via its own node id; n4..n6 don't have "n3" anywhere.
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n3']));
  });

  it('OR-combines matches across fields by default', () => {
    // "chimpanzee" only matches via taxonomy-common (n4).
    // "AT1G01010" only matches via gene-id (n5).
    // A query that hits at least one field per leaf in different
    // fields demonstrates the OR: "Pan|AT1G01020" (regex) catches
    // n4 via taxonomy-scientific AND n6 via gene-id simultaneously.
    const r = resolveMatches(
      data,
      { query: 'Pan|AT1G01020', regex: true },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n4', 'n6']));
  });

  it('matches gene name (geneMetadata.displayName)', () => {
    const r = resolveMatches(
      data,
      { query: 'NAC001' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n5']));
  });

  it('matches gene description (geneMetadata.description)', () => {
    const r = resolveMatches(
      data,
      { query: 'transcription factor' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n5']));
  });

  it('case-insensitive substring match on gene id', () => {
    const r = resolveMatches(
      data,
      { query: 'brca2' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n3', 'n4']));
    expect(new Set(r.matchedAncestorIds)).toEqual(new Set(['n0', 'n1']));
    expect(r.truncated).toBe(false);
    expect(r.regexError).toBeNull();
  });

  it('case-sensitive matching honours the flag', () => {
    const r = resolveMatches(
      data,
      { query: 'brca2', caseSensitive: true },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(r.matchedLeafIds.size).toBe(0);
  });

  it('respects excludedFields — turning off taxonomy-common drops the match', () => {
    // "cress" only appears in taxonomy-common ("thale cress"); not in
    // any gene id, scientific name, or node id in the test fixture.
    const baseline = resolveMatches(
      data,
      { query: 'cress' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(new Set(baseline.matchedLeafIds)).toEqual(new Set(['n5', 'n6']));

    const filtered = resolveMatches(
      data,
      { query: 'cress', excludedFields: ['taxonomy-common'] },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(filtered.matchedLeafIds.size).toBe(0);
  });

  it('returns empty results when every field is excluded', () => {
    const allIds = BUILTIN_SEARCH_FIELDS.map((f) => f.id);
    const r = resolveMatches(
      data,
      { query: 'BRCA2', excludedFields: allIds },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(r.matchedLeafIds.size).toBe(0);
  });

  it('regex applied across all active fields', () => {
    const r = resolveMatches(
      data,
      { query: '^Pan ', regex: true },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    // Matches "Pan troglodytes" (n4's taxonomy-scientific). Other
    // fields' values for n4 don't start with "Pan ", but ANY hit wins.
    expect(new Set(r.matchedLeafIds)).toEqual(new Set(['n4']));
  });

  it('surfaces regex errors when every active field fails to compile', () => {
    const r = resolveMatches(
      data,
      { query: '(', regex: true },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(r.matchedLeafIds.size).toBe(0);
    expect(r.regexError).toBeTruthy();
  });

  it('skips leaves hidden by prune', () => {
    const pruned = new Set(['n1']); // hides n3, n4
    const r = resolveMatches(
      data,
      { query: 'BRCA2' },
      BUILTIN_SEARCH_FIELDS,
      pruned,
    );
    expect(r.matchedLeafIds.size).toBe(0);
  });

  it(`caps at ${SEARCH_MATCH_LIMIT} matches and reports truncated`, () => {
    // Build a wide tree with 10100 leaves all matching `gene`.
    const N = SEARCH_MATCH_LIMIT + 100;
    const nodes: Tree['nodes'] = {
      root: { id: 'root', parentId: null, distance: 0, isLeaf: false },
    };
    for (let i = 0; i < N; i++) {
      const id = `leaf${i}`;
      nodes[id] = {
        id,
        parentId: 'root',
        distance: 1,
        isLeaf: true,
        geneId: `gene${i}`,
      };
    }
    const big: HostData = { tree: { rootId: 'root', nodes } };
    const r = resolveMatches(
      big,
      { query: 'gene' },
      BUILTIN_SEARCH_FIELDS,
      noPrune,
    );
    expect(r.matchedLeafIds.size).toBe(SEARCH_MATCH_LIMIT);
    expect(r.truncated).toBe(true);
  });
});
