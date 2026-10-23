/**
 * Construction and maintenance of a `ViewState` without React: the initial
 * state for a zone list (with pivot, exclusive groups and availability), the
 * reset applied when a new tree is loaded, reconciliation of the zone list,
 * and a tolerant deserialiser for persisted blobs.
 *
 * Origins: `tbrowse/src/store.tsx:53-127` (defaults and
 * `buildInitialViewState`), `tbrowse/examples/playground/main.tsx:836-846`
 * (`softResetForSourceSwitch`), and
 * `gramene-search/src/components/results/TaxDistTbrowse.js:180-200`
 * (pixel-to-fr zone sizing).
 */
import { computePivotState, type PivotState } from '../tree/pivot';
import type {
  HostData,
  NodeId,
  SearchState,
  ViewState,
  ZoneSpec,
  ZoneViewState,
} from '../types';

/**
 * The all-empty view state: nothing selected, collapsed, pruned, swapped or
 * compressed; no node of interest; no zones; no search. Every other builder
 * in this module starts from it. Origin: `tbrowse/src/store.tsx:53-63`
 * (`baseDefaults`).
 */
export const EMPTY_VIEW_STATE: Readonly<ViewState> = Object.freeze({
  selectedNodeId: null,
  collapsedNodeIds: [],
  prunedNodeIds: [],
  swappedNodeIds: [],
  compressedNodeIds: [],
  nodeOfInterestId: null,
  zones: [],
  zoneStates: {},
  search: null,
});

/** Options for {@link buildInitialViewState}. */
export interface InitialViewStateOptions {
  /**
   * Host data used for each zone's `isAvailable` check and for resolving
   * `nodeOfInterest` against the tree. When omitted every zone is treated as
   * available and no pivot is computed.
   */
  data?: HostData;
  /** Leaf gene id or node id to pivot the tree onto (see `computePivotState`). */
  nodeOfInterest?: string | null;
  /** Per-zone initial width (fr share), overriding `ZoneSpec.defaultWidth`. */
  widths?: Record<string, number>;
  /**
   * Per-zone initial visibility. Applied BEFORE the exclusive-group claim, so
   * forcing a zone visible lets it win its group's slot, and forcing one
   * hidden passes the slot to the next member.
   */
  visible?: Record<string, boolean>;
  /**
   * Per-zone state merged over each zone's `defaultZoneState`: a key here
   * wins over the seeded entry for that zone, and when both the seeded
   * default and the supplied value are plain objects they are shallow-merged
   * so unspecified fields keep their defaults. Zones not mentioned keep
   * their seeded defaults.
   */
  zoneStates?: Record<string, unknown>;
  /**
   * Spread LAST, verbatim, over the computed state (the `initialViewState`
   * prop of the viewer). `overrides.zoneStates` therefore REPLACES the
   * seeded map and `overrides.zones` replaces the zone list.
   */
  overrides?: Partial<ViewState>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Build the initial `ViewState` for a list of zones. Reproduces the viewer's
 * `buildInitialViewState` (origin `tbrowse/src/store.tsx:65-127`) with the
 * host data and viewer props replaced by {@link InitialViewStateOptions}:
 *
 * - `zoneStates` is seeded from each zone's `defaultZoneState`, then
 *   `opts.zoneStates` is merged over it per zone.
 * - When `opts.nodeOfInterest` is given (and `opts.data` carries the tree),
 *   `computePivotState` supplies `collapsedNodeIds`, `swappedNodeIds` and
 *   `nodeOfInterestId`; an unresolvable identifier leaves them empty.
 * - Each zone's initial visibility is `(defaultVisible ?? true) &&
 *   isAvailable(data)`, with the availability check skipped (treated as
 *   true) when `opts.data` is omitted, then overridden by `opts.visible`,
 *   then subjected to the exclusive-group rule: the first qualifying member
 *   of a group claims it and later members start hidden.
 * - Each zone entry is `{ id, width: opts.widths?.[id] ?? defaultWidth, visible }`.
 * - `opts.overrides` is spread last, verbatim.
 *
 * `rowHeight` / `fontSize` are deliberately left unset so they stay
 * resolvable from host props at read time.
 */
export function buildInitialViewState(
  zones: readonly ZoneSpec[],
  opts: InitialViewStateOptions = {},
): ViewState {
  const data = opts.data;
  const zoneStates: Record<string, unknown> = {};
  for (const z of zones) {
    zoneStates[z.id] = z.defaultZoneState;
  }
  if (opts.zoneStates) {
    for (const [id, supplied] of Object.entries(opts.zoneStates)) {
      const seeded = zoneStates[id];
      zoneStates[id] =
        isPlainObject(seeded) && isPlainObject(supplied) ? { ...seeded, ...supplied } : supplied;
    }
  }

  let collapsedFromPivot: NodeId[] = [];
  let swappedFromPivot: NodeId[] = [];
  let nodeOfInterestId: NodeId | null = null;
  if (opts.nodeOfInterest && data) {
    const pivot = computePivotState(data.tree, opts.nodeOfInterest);
    if (pivot) {
      collapsedFromPivot = pivot.collapsedNodeIds;
      swappedFromPivot = pivot.swappedNodeIds;
      nodeOfInterestId = pivot.targetId;
    }
  }

  // Mutually-exclusive groups start linked, so at most one member may be
  // visible on first paint — the first that qualifies wins.
  const claimed = new Set<string>();
  const zoneEntries: ZoneViewState[] = zones.map((z) => {
    // Initial visibility = (the zone opts in via `defaultVisible`, default
    // true) AND (its data is available right now). Zones that opt out
    // (defaultVisible: false) stay hidden on first paint and rely on the
    // viewer's auto-enable effect to flip them on once their data arrives.
    let visible = (z.defaultVisible ?? true) && (data ? z.isAvailable(data) : true);
    const forced = opts.visible?.[z.id];
    if (forced !== undefined) visible = forced;
    if (visible && z.exclusiveGroup) {
      if (claimed.has(z.exclusiveGroup)) visible = false;
      else claimed.add(z.exclusiveGroup);
    }
    return { id: z.id, width: opts.widths?.[z.id] ?? z.defaultWidth, visible };
  });

  return {
    ...EMPTY_VIEW_STATE,
    collapsedNodeIds: collapsedFromPivot,
    swappedNodeIds: swappedFromPivot,
    nodeOfInterestId,
    zones: zoneEntries,
    zoneStates,
    ...opts.overrides,
  };
}

/**
 * Apply a pivot (from `computePivotState`) to an existing view state: the
 * pivot's collapsed and swapped sets replace the current ones and its
 * `targetId` becomes the node of interest. A `null` pivot (identifier not
 * found) returns `vs` unchanged, same reference. Mirrors how the viewer
 * seeds these three fields in `buildInitialViewState`
 * (`tbrowse/src/store.tsx:88-96`) and how gramene-search seeds its bundle
 * (`Homology.js:154-161`).
 */
export function applyPivot(vs: ViewState, pivot: PivotState | null): ViewState {
  if (!pivot) return vs;
  return {
    ...vs,
    collapsedNodeIds: pivot.collapsedNodeIds,
    swappedNodeIds: pivot.swappedNodeIds,
    nodeOfInterestId: pivot.targetId,
  };
}

/**
 * Reset the parts of a view state that refer to tree nodes — selection,
 * collapsed / pruned / swapped / compressed sets, node of interest and the
 * search — while keeping everything that describes the layout: `zones`,
 * `zoneStates`, `rowHeight`, `fontSize` and `unlinkedZoneGroups`. Use it
 * when the host swaps in a different tree so zone arrangement survives.
 * Origin: `tbrowse/examples/playground/main.tsx:836-846`
 * (`softResetForSourceSwitch`).
 */
export function softResetForNewTree(vs: ViewState): ViewState {
  return {
    ...vs,
    selectedNodeId: null,
    collapsedNodeIds: [],
    prunedNodeIds: [],
    swappedNodeIds: [],
    compressedNodeIds: [],
    nodeOfInterestId: null,
    search: null,
  };
}

/**
 * Reconcile `vs.zones` with a zone list: entries whose id is not in `zones`
 * are dropped, the surviving entries keep their relative order, and a fresh
 * entry `{ id, width: defaultWidth, visible: defaultVisible ?? true }` is
 * appended for every zone that had none. `zoneStates` is left untouched.
 * Returns `vs` itself (same reference) when nothing needs to change.
 */
export function ensureZones(vs: ViewState, zones: readonly ZoneSpec[]): ViewState {
  const known = new Map<string, ZoneSpec>();
  for (const z of zones) known.set(z.id, z);
  const current = vs.zones ?? [];
  const kept = current.filter((entry) => known.has(entry.id));
  const present = new Set(kept.map((entry) => entry.id));
  const appended: ZoneViewState[] = [];
  for (const z of zones) {
    if (present.has(z.id)) continue;
    present.add(z.id);
    appended.push({ id: z.id, width: z.defaultWidth, visible: z.defaultVisible ?? true });
  }
  if (kept.length === current.length && appended.length === 0) return vs;
  return { ...vs, zones: [...kept, ...appended] };
}

function idArray(v: unknown): NodeId[] {
  return Array.isArray(v) ? v.filter((x): x is NodeId => typeof x === 'string') : [];
}

function stringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

function nodeIdOrNull(v: unknown): NodeId | null {
  return typeof v === 'string' ? v : null;
}

/** Width used for a persisted zone entry whose width is missing or not a finite number. */
const FALLBACK_ZONE_WIDTH = 25;

function normalizeZones(v: unknown): ZoneViewState[] {
  if (!Array.isArray(v)) return [];
  const out: ZoneViewState[] = [];
  for (const raw of v) {
    if (!isPlainObject(raw) || typeof raw['id'] !== 'string') continue;
    const width = raw['width'];
    const visible = raw['visible'];
    const userToggled = raw['userToggled'];
    out.push({
      id: raw['id'],
      width: typeof width === 'number' && Number.isFinite(width) ? width : FALLBACK_ZONE_WIDTH,
      visible: typeof visible === 'boolean' ? visible : true,
      ...(typeof userToggled === 'boolean' ? { userToggled } : {}),
    });
  }
  return out;
}

function normalizeSearch(v: unknown): SearchState | null {
  if (!isPlainObject(v) || typeof v['query'] !== 'string') return null;
  const excludedFields = stringArray(v['excludedFields']);
  const caseSensitive = v['caseSensitive'];
  const regex = v['regex'];
  return {
    query: v['query'],
    ...(excludedFields !== undefined ? { excludedFields } : {}),
    ...(typeof caseSensitive === 'boolean' ? { caseSensitive } : {}),
    ...(typeof regex === 'boolean' ? { regex } : {}),
  };
}

/**
 * Tolerant deserialiser: turn any value — a partial state, an old persisted
 * blob with missing or extra fields, or garbage — into a complete
 * `ViewState`. Missing id arrays become `[]`, a missing or malformed `search`
 * becomes `null`, unknown fields are dropped, and `zoneStates` is kept as-is
 * (keys for unknown zones are preserved since a host-defined zone may own
 * them). Malformed zone entries are dropped; an entry with a non-numeric
 * width gets 25 and a non-boolean `visible` becomes true. When `zones` is
 * given the result is passed through {@link ensureZones} so every known zone
 * has an entry and no unknown zone does.
 */
export function normalizeViewState(input: unknown, zones?: readonly ZoneSpec[]): ViewState {
  const src: Record<string, unknown> = isPlainObject(input) ? input : {};
  const rowHeight = src['rowHeight'];
  const fontSize = src['fontSize'];
  const unlinkedZoneGroups = stringArray(src['unlinkedZoneGroups']);
  const zoneStates = src['zoneStates'];
  const vs: ViewState = {
    selectedNodeId: nodeIdOrNull(src['selectedNodeId']),
    collapsedNodeIds: idArray(src['collapsedNodeIds']),
    prunedNodeIds: idArray(src['prunedNodeIds']),
    swappedNodeIds: idArray(src['swappedNodeIds']),
    compressedNodeIds: idArray(src['compressedNodeIds']),
    nodeOfInterestId: nodeIdOrNull(src['nodeOfInterestId']),
    zones: normalizeZones(src['zones']),
    zoneStates: isPlainObject(zoneStates) ? zoneStates : {},
    ...(typeof rowHeight === 'number' && Number.isFinite(rowHeight) ? { rowHeight } : {}),
    ...(typeof fontSize === 'number' && Number.isFinite(fontSize) ? { fontSize } : {}),
    ...(unlinkedZoneGroups !== undefined ? { unlinkedZoneGroups } : {}),
    search: normalizeSearch(src['search']),
  };
  return zones ? ensureZones(vs, zones) : vs;
}

/**
 * Convert target pixel widths into zone fr-shares. The viewer lays zones out
 * as fractions (`rendered px = width / Σwidths × container px`), so if the
 * shares sum to the container width, 1 fr ≈ 1 px: every zone in `targetPx`
 * gets its pixel target as its share and `flexZoneId` absorbs the remainder,
 * `max(minFlexPx, containerPx − Σ targets)`. A `targetPx` entry for the flex
 * zone itself is ignored. Origin:
 * `gramene-search/src/components/results/TaxDistTbrowse.js:180-200`.
 */
export function pixelWidthsToFr(
  targetPx: Record<string, number>,
  containerPx: number,
  flexZoneId: string,
  minFlexPx = 160,
): Record<string, number> {
  const out: Record<string, number> = {};
  let used = 0;
  for (const [id, px] of Object.entries(targetPx)) {
    if (id === flexZoneId) continue;
    out[id] = px;
    used += px;
  }
  out[flexZoneId] = Math.max(minFlexPx, containerPx - used);
  return out;
}
