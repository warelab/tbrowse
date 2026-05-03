import type {
  HostData,
  NodeId,
  SearchResults,
  SearchState,
  Tree,
  TreeNode,
} from '../types';
import { SEARCH_MATCH_LIMIT } from '../types';
import type { SearchField } from './fields';

const EMPTY_RESULTS: SearchResults = {
  matchedLeafIds: new Set(),
  matchedAncestorIds: new Set(),
  truncated: false,
  regexError: null,
};

/**
 * Run the active search against the tree. By default every registered
 * `SearchField` is active and a leaf matches if its value in ANY
 * active field matches the query (logical OR). Hosts can narrow the
 * set per-search by listing field ids in `SearchState.excludedFields`
 * — the search bar's per-field checkboxes maintain that list.
 *
 * Results are capped at `SEARCH_MATCH_LIMIT`; pruned leaves are
 * excluded so a "match" you can't see doesn't inflate the count.
 *
 * Regex error handling is forgiving: if the query is interpreted as
 * a regex but only some fields fail to compile (e.g. a custom field
 * with a different regex flavour), the working fields still
 * contribute matches. Only when EVERY active field fails does the
 * search bar see a regex error.
 *
 * Pure and inexpensive — designed to run inside a `useMemo` keyed
 * on the search state and the relevant slices of host data.
 */
export function resolveMatches(
  data: HostData,
  search: SearchState | null,
  fields: ReadonlyArray<SearchField>,
  prunedNodeIds: ReadonlySet<NodeId>,
): SearchResults {
  if (!search || !search.query) return EMPTY_RESULTS;

  const excluded = new Set(search.excludedFields ?? []);
  const activeFields = fields.filter((f) => !excluded.has(f.id));
  if (activeFields.length === 0) return EMPTY_RESULTS;

  const opts = {
    data,
    caseSensitive: search.caseSensitive ?? false,
    regex: search.regex ?? false,
  };

  const predicates: Array<(node: TreeNode) => boolean> = [];
  let firstError: string | null = null;
  for (const f of activeFields) {
    const compiled = f.buildPredicate(search.query, opts);
    if (compiled.ok) {
      predicates.push(compiled.test);
    } else if (firstError === null) {
      firstError = compiled.error;
    }
  }
  if (predicates.length === 0) {
    return { ...EMPTY_RESULTS, regexError: firstError };
  }

  const matched = new Set<NodeId>();
  let truncated = false;

  for (const id of Object.keys(data.tree.nodes)) {
    const node = data.tree.nodes[id];
    if (!node.isLeaf) continue;
    if (isHiddenByPrune(node.id, data.tree, prunedNodeIds)) continue;
    let hit = false;
    for (let i = 0; i < predicates.length; i++) {
      if (predicates[i](node)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    matched.add(node.id);
    if (matched.size >= SEARCH_MATCH_LIMIT) {
      truncated = true;
      break;
    }
  }

  if (matched.size === 0) {
    return { ...EMPTY_RESULTS, truncated };
  }
  return {
    matchedLeafIds: matched,
    matchedAncestorIds: collectAncestors(matched, data.tree),
    truncated,
    regexError: null,
  };
}

/** Closure of every ancestor id covering at least one matched leaf.
 *  Builds in O(matches × depth) with early break on already-seen
 *  ancestors so deep trees with many matches don't re-walk shared
 *  spines. */
function collectAncestors(
  leafIds: ReadonlySet<NodeId>,
  tree: Tree,
): Set<NodeId> {
  const out = new Set<NodeId>();
  for (const leafId of leafIds) {
    let cur = tree.nodes[leafId]?.parentId ?? null;
    while (cur !== null) {
      if (out.has(cur)) break;
      out.add(cur);
      cur = tree.nodes[cur]?.parentId ?? null;
    }
  }
  return out;
}

/** A leaf is hidden by prune if any ancestor (or the leaf itself)
 *  appears in `prunedNodeIds`. Walks at most depth steps per leaf. */
function isHiddenByPrune(
  leafId: NodeId,
  tree: Tree,
  pruned: ReadonlySet<NodeId>,
): boolean {
  if (pruned.size === 0) return false;
  let cur: NodeId | null = leafId;
  while (cur !== null) {
    if (pruned.has(cur)) return true;
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return false;
}
