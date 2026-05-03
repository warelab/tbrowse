import type { HostData, TreeNode } from '../types';

/**
 * A pluggable search "field" — i.e. one of the dropdown choices in
 * the search bar. Each field knows how to compile a query string
 * into a leaf predicate and (optionally) how to surface the matched
 * span back to a zone for in-place highlighting.
 *
 * Built-ins live below. Hosts may register additional fields via
 * `TBrowseProps.searchFields` to expose metadata-specific search
 * (e.g. Pfam id, custom annotation values) without forking the
 * library.
 */
export interface SearchField {
  /** Stable id, persisted in `ViewState.search.field`. */
  id: string;
  /** Label shown in the field dropdown. */
  label: string;
  /**
   * Compile the query once per (query, opts) change so the inner
   * leaf-scan loop stays branch-free. Returns a predicate or
   * `null` when the query can't be compiled (e.g. malformed
   * regex). The chassis surfaces compilation failure to the search
   * bar without crashing.
   */
  buildPredicate: (
    query: string,
    opts: SearchPredicateOptions,
  ) =>
    | { ok: true; test: (node: TreeNode) => boolean }
    | { ok: false; error: string };
  /**
   * Optional — describe which substring of a leaf's value matched
   * so a zone can highlight it in place (e.g. labels zone wraps
   * the matching character range in a `<mark>`). Returns `null`
   * when the leaf doesn't match or the field doesn't expose a
   * span (e.g. taxonomy match → whole label highlighted).
   */
  describeMatch?: (
    node: TreeNode,
    query: string,
    opts: SearchPredicateOptions,
    data: HostData,
  ) => MatchSpan | null;
}

export interface SearchPredicateOptions {
  data: HostData;
  caseSensitive: boolean;
  regex: boolean;
}

/** A character range within a particular field's string value. */
export interface MatchSpan {
  /** The full string the span is into — useful for fields whose
   *  value is computed (e.g. "scientific (common)") so the zone
   *  doesn't have to recompute it. */
  value: string;
  start: number;
  /** Exclusive end index. */
  end: number;
}

/** Compile a string query into a tester. Returns null on bad
 *  regex; callers branch on `ok`. Shared by the built-in fields
 *  below — keep the regex/case logic in one place. */
export function compileStringMatcher(
  query: string,
  { caseSensitive, regex }: { caseSensitive: boolean; regex: boolean },
):
  | { ok: true; test: (s: string) => boolean; spanOf: (s: string) => [number, number] | null }
  | { ok: false; error: string } {
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, caseSensitive ? '' : 'i');
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return {
      ok: true,
      test: (s: string) => re.test(s),
      spanOf: (s: string) => {
        // Reset lastIndex defensively — we never set the `g` flag, but
        // hosts may pass user-supplied regex that does.
        re.lastIndex = 0;
        const m = re.exec(s);
        return m ? [m.index, m.index + m[0].length] : null;
      },
    };
  }
  if (query.length === 0) {
    return { ok: false, error: 'empty query' };
  }
  if (caseSensitive) {
    return {
      ok: true,
      test: (s: string) => s.includes(query),
      spanOf: (s: string) => {
        const i = s.indexOf(query);
        return i >= 0 ? [i, i + query.length] : null;
      },
    };
  }
  const needle = query.toLowerCase();
  return {
    ok: true,
    test: (s: string) => s.toLowerCase().includes(needle),
    spanOf: (s: string) => {
      const i = s.toLowerCase().indexOf(needle);
      return i >= 0 ? [i, i + query.length] : null;
    },
  };
}

/** Resolve the string value to search for a given node + field id.
 *  Returns null when the field has no value for that node (so the
 *  predicate skips). */
type StringValueFn = (node: TreeNode, data: HostData) => string | null;

function stringFieldFromValue(
  id: string,
  label: string,
  valueOf: StringValueFn,
): SearchField {
  return {
    id,
    label,
    buildPredicate(query, opts) {
      const matcher = compileStringMatcher(query, opts);
      if (!matcher.ok) return matcher;
      return {
        ok: true,
        test: (node) => {
          const v = valueOf(node, opts.data);
          return v != null && matcher.test(v);
        },
      };
    },
    describeMatch(node, query, opts, data) {
      const v = valueOf(node, data);
      if (v == null) return null;
      const matcher = compileStringMatcher(query, opts);
      if (!matcher.ok) return null;
      const span = matcher.spanOf(v);
      return span ? { value: v, start: span[0], end: span[1] } : null;
    },
  };
}

const geneIdField = stringFieldFromValue(
  'gene-id',
  'Gene id',
  (node) => node.geneId ?? null,
);

const geneNameField = stringFieldFromValue(
  'gene-name',
  'Gene name',
  (node, data) => {
    if (!node.geneId) return null;
    const v = data.geneMetadata?.[node.geneId]?.displayName;
    return typeof v === 'string' ? v : null;
  },
);

const geneDescriptionField = stringFieldFromValue(
  'gene-description',
  'Gene description',
  (node, data) => {
    if (!node.geneId) return null;
    const v = data.geneMetadata?.[node.geneId]?.description;
    return typeof v === 'string' ? v : null;
  },
);

const nodeIdField = stringFieldFromValue(
  'node-id',
  'Node id',
  (node) => node.id,
);

const taxonomyScientificField = stringFieldFromValue(
  'taxonomy-scientific',
  'Taxonomy (scientific name)',
  (node, data) => {
    if (node.taxonomyId === undefined) return null;
    return data.taxonomy?.[node.taxonomyId]?.scientificName ?? null;
  },
);

const taxonomyCommonField = stringFieldFromValue(
  'taxonomy-common',
  'Taxonomy (common name)',
  (node, data) => {
    if (node.taxonomyId === undefined) return null;
    return data.taxonomy?.[node.taxonomyId]?.commonName ?? null;
  },
);

/** Built-in search fields, in display order. All are active by
 *  default — the user opts out per-field via the search bar's
 *  Fields popover (persisted in `SearchState.excludedFields`). */
export const BUILTIN_SEARCH_FIELDS: ReadonlyArray<SearchField> = [
  geneIdField,
  geneNameField,
  geneDescriptionField,
  taxonomyScientificField,
  taxonomyCommonField,
  nodeIdField,
];
