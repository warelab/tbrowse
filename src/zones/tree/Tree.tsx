import { useMemo, useRef } from 'react';
import {
  ancestorIdsOf,
  buildChildrenIndex,
  countLeavesInSubtree,
  EMPTY_NODE_ID_SET,
} from '../../treeIndex';
import { describeHoveredNodeForHeader } from '../headerInfo';
import { EditableZoneName } from '../EditableZoneName';
import type { NodeId, ZoneDefinition, ZoneRenderProps } from '../../types';
import { computeTreeLayout, type TreeLayoutNode, type TreeLayoutMode } from './layout';
import { Tooltip } from './Tooltip';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';

// LEFT_PAD must be ≥ ROOT_STUB_LEN so the stub drawn left of the root has
// room inside the SVG. (The stub is what users hover/click to interact with
// the root node, since the root's own branch is zero-length.)
const LEFT_PAD = 16;
// RIGHT_PAD must be ≥ COLLAPSED_TRIANGLE_WIDTH_MAX so that when a
// collapsed-summary node ends up at the deepest visible depth (i.e.
// lands at drawingLeftX + drawingWidth) its triangle, which extends
// up to COLLAPSED_TRIANGLE_WIDTH_MAX to the right of the apex,
// doesn't overflow the zone's `overflow: hidden` clip and get cut
// off. Adds a few extra px of breathing room so the triangle's base
// doesn't sit flush against the labels-zone divider.
const RIGHT_PAD = 44;
// Minimal right gutter when leaf extensions are off and no collapsed-summary
// triangle needs room — just enough to not sit flush against the zone divider.
const MIN_RIGHT_PAD = 6;

// Theme-aware colour values: SVG presentation attributes accept var()
// references the same way `style` does, so we string them as
// `var(--name)` here and they re-evaluate when the theme class flips on
// the root.
const BRANCH_COLOR = 'var(--tbrowse-branch)';
const HIGHLIGHT_COLOR = 'var(--tbrowse-accent)';
/** Branches are scaled by the absolute number of leaves under
 *  them: each ×4 multiple of subtree leaf count adds one pixel of
 *  thickness, clamped to `[BRANCH_WIDTH_MIN, BRANCH_WIDTH_MAX]`.
 *  Thresholds land at 1, 4, 16, 64 leaves → 1, 2, 3, 4 px;
 *  branches with more than 64 leaves stay at the 4 px ceiling.
 *  Independent of total tree size — two trees with 50 vs 5000
 *  leaves both give a 16-leaf subtree the same 3 px thickness.
 *  Hovered / highlighted branches add `BRANCH_WIDTH_HIGHLIGHT_BUMP`
 *  on top so the cursor cue stays visible at every thickness. */
const BRANCH_WIDTH_MIN = 1;
const BRANCH_WIDTH_MAX = 3;
const BRANCH_WIDTH_HIGHLIGHT_BUMP = 1.25;
/** Each step multiplies the leaf count by `LEAVES_PER_STEP` and
 *  bumps the output by `(max − min) / MAX_STEPS`. With
 *  `LEAVES_PER_STEP = 4` and `MAX_STEPS = 3`, the cutoffs sit at
 *  leaf counts 1, 4, 16, 64 and the output spans `min`, `min +
 *  (max−min)/3`, `min + 2(max−min)/3`, `max`. Branch thickness
 *  (1→4 px) and triangle length (14→38 px) share the curve. */
const BRANCH_WIDTH_LEAVES_PER_STEP = 4;
/** Fixed horizontal length of the pruned-stub connector's
 *  horizontal arm. The connector is an L: vertical from the anchor
 *  branch up/down to `stubY`, then horizontal out to `markX`. */
const PRUNED_STUB_LEN = 8;
/** Fixed vertical gap from one stub to the next in a stack on the
 *  same side of the anchor — also the gap between the first stub
 *  and the anchor branch itself. Pruned stubs are intentionally
 *  uniform: their geometry doesn't reflect the size of the pruned
 *  clade, so the eye treats every prune-marker the same regardless
 *  of how much got cut. */
const PRUNED_STUB_GAP = 6;
/** Fixed stroke width for every pruned-stub connector. */
const PRUNED_STUB_WIDTH = 1;
const BRANCH_WIDTH_MAX_STEPS = 3;
const EXTENSION_COLOR = 'var(--tbrowse-leaf-extension)';
const EXTENSION_HIGHLIGHT_COLOR = 'var(--tbrowse-accent)';
// Selection amber stays fixed — it reads on both themes and is meant to
// be unambiguous.
const SELECT_COLOR = '#f59e0b';
const SELECT_RADIUS = 5;
const HIT_STROKE_WIDTH = 12;
const SPECIATION_COLOR = 'var(--tbrowse-text-muted)';
const DUPLICATION_COLOR = 'var(--tbrowse-danger)';
const NODE_GLYPH_RADIUS = 3.8;
/** Slightly smaller than the internal-node glyph so leaves read as
 *  terminal "ticks" rather than competing with the speciation circles. */
const LEAF_GLYPH_RADIUS = 2.5;
const NODE_GLYPH_SQUARE = 7;
/** Collapsed-summary triangles stretch to the right with subtree
 *  size, on the same `1, 4, 16, 64` cutoffs as the branch-thickness
 *  scale. A degenerate single-leaf collapse renders at the MIN
 *  length; a 64+ leaf collapse hits the MAX. Step size is
 *  `(MAX − MIN) / 3` so the four cutoffs map evenly onto the four
 *  thickness levels. */
const COLLAPSED_TRIANGLE_WIDTH_MIN = 14;
const COLLAPSED_TRIANGLE_WIDTH_MAX = 38;
/** Search-match highlight: an outer ring drawn around the leaf-tip
 *  glyph for matched leaves, and used to tint collapsed-summary
 *  triangles whose subtree contains at least one match. */
const SEARCH_MATCH_COLOR = 'var(--tbrowse-search, #fbbf24)';
const SEARCH_MATCH_RING_RADIUS = 5;
const SEARCH_MATCH_RING_WIDTH = 1.75;
/** Length of the visible/clickable horizontal stub drawn to the left of the
 *  root node so the root has a hit area (its own branch is zero-length). */
const ROOT_STUB_LEN = 10;
const COLLAPSED_TRIANGLE_MIN_H = 8;
const COLLAPSED_TRIANGLE_MAX_H = 22;
const COLLAPSED_TRIANGLE_FILL = 'rgba(128, 128, 140, 0.22)';
const COLLAPSED_TRIANGLE_STROKE = 'var(--tbrowse-text-muted)';

/** Width of the compressed-root-path glyph (the "||||||||" string).
 *  Enabled by `TreeZoneState.rerootCompression`; the chain of
 *  unbranched internal-node ancestors above the effective root is
 *  visually replaced with a fixed-width run of vertical pipes. */
const COMPRESSED_PATH_WIDTH = 26;
const COMPRESSED_PATH_BAR_COUNT = 8;
const COMPRESSED_PATH_BAR_HEIGHT = 7;

function collapsedTriangleHeight(leafCount: number): number {
  // Logarithmic so a 2-leaf and a 1000-leaf collapsed subtree are
  // distinguishable but both stay inside a single row's height.
  const h = 4 + Math.log2(Math.max(1, leafCount + 1)) * 4;
  return Math.max(COLLAPSED_TRIANGLE_MIN_H, Math.min(COLLAPSED_TRIANGLE_MAX_H, h));
}

/**
 * Visual style used when rendering "pruned-branch" markers — the little
 * affordances dangling off an anchor branch where the user has hidden a
 * subtree. The default `'square'` is the original look (hollow square at
 * the end of a dashed L-bend); the other options are alternatives we're
 * trialling — see the playground dropdown for live previews.
 */
export type PrunedNodeStyle =
  | 'square'
  | 'triangle'
  | 'cap'
  | 'slash'
  | 'scissors'
  | 'ellipsis'
  | 'ghost'
  | 'minitree'
  | 'count'
  | 'broken'
  | 'bracket';

export interface TreeZoneState {
  /** User-set zone name; falls back to the factory default when undefined. */
  name?: string;
  prunedNodeStyle?: PrunedNodeStyle;
  /** When true (default), an unbranched chain of internal nodes
   *  from the root down to the first visible "real" content (a
   *  fork or a visible end) is collapsed into a compact
   *  fixed-width visual element that reads as a string of vertical
   *  pipes. This kicks in when the user has pruned everything
   *  except a single deep subtree so the spine connecting that
   *  subtree back to the root is just a long single-child run. */
  /** Tree layout mode. 'phylogram' (default) positions nodes by branch
   *  length; 'cladogram' ignores branch lengths and aligns all visible ends
   *  at the right edge — appropriate for rank trees (e.g. a taxonomy) that
   *  carry no meaningful distances. */
  layoutMode?: TreeLayoutMode;
  /** Draw the dashed leader lines from each leaf/collapsed tip to the right
   *  edge of the zone. Default true. Hosts that put labels in an adjacent
   *  zone (so the dashes would run to a bare edge) can set this false. */
  showLeafExtensions?: boolean;
  rerootCompression?: boolean;
  /** When true (default), branches longer than ~5× the median branch
   *  length get visually shortened (with a `//` cut mark) so the rest of
   *  the tree doesn't get squished. Per-branch overrides via
   *  `ViewState.compressedNodeIds` still XOR with this flag. Toggled
   *  zone-wide by the header `//` button. */
  autoCompressLongBranches?: boolean;
}

const DEFAULT_PRUNED_STYLE: PrunedNodeStyle = 'triangle';

const TreeHeader = ({
  hoveredNodeId,
  data,
  zoneState,
  setZoneState,
}: ZoneRenderProps<TreeZoneState>) => {
  const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);
  const hoveredInfo = useMemo(
    () => describeHoveredNodeForHeader(hoveredNodeId, data, childrenIndex),
    [hoveredNodeId, data, childrenIndex],
  );
  const compress = zoneState?.autoCompressLongBranches ?? true;
  const toggleCompress = () =>
    setZoneState((s) => ({
      ...(s ?? {}),
      autoCompressLongBranches: !(s?.autoCompressLongBranches ?? true),
    }));
  const cladogram = (zoneState?.layoutMode ?? 'phylogram') === 'cladogram';
  const toggleLayoutMode = () =>
    setZoneState((s) => ({
      ...(s ?? {}),
      layoutMode:
        (s?.layoutMode ?? 'phylogram') === 'cladogram'
          ? 'phylogram'
          : 'cladogram',
    }));
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: 'var(--tbrowse-text)',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px 0 18px',
        }}
      >
        <EditableZoneName
          defaultName="Tree"
          customName={zoneState?.name}
          onChange={(next) =>
            setZoneState((s) => ({ ...(s ?? {}), name: next }))
          }
        />
        <button
          type="button"
          onClick={toggleCompress}
          title={
            compress
              ? 'Long branches compressed — click to show full lengths'
              : 'Long branches at full length — click to compress outliers'
          }
          style={{
            fontSize: 11,
            padding: '1px 6px',
            border: `1px solid ${compress ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
            background: compress
              ? 'var(--tbrowse-accent-soft)'
              : 'var(--tbrowse-bg-input)',
            color: compress
              ? 'var(--tbrowse-accent-strong)'
              : 'var(--tbrowse-text)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          //
        </button>
        <button
          type="button"
          onClick={toggleLayoutMode}
          title={
            cladogram
              ? 'Cladogram — tips aligned, branch lengths ignored. Click for phylogram.'
              : 'Phylogram — positioned by branch length. Click for cladogram (aligned tips).'
          }
          style={{
            fontSize: 11,
            padding: '1px 6px',
            border: `1px solid ${cladogram ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
            background: cladogram
              ? 'var(--tbrowse-accent-soft)'
              : 'var(--tbrowse-bg-input)',
            color: cladogram
              ? 'var(--tbrowse-accent-strong)'
              : 'var(--tbrowse-text)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          {cladogram ? 'clad' : 'phylo'}
        </button>
      </div>
      {/* Second row: live readout of the hovered node. */}
      <div
        style={{
          flex: `0 0 ${LEAF_ROW_HEIGHT}px`,
          minHeight: 0,
          padding: '0 10px 0 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--tbrowse-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={hoveredInfo ?? ''}
      >
        {hoveredInfo ?? <span style={{ color: 'var(--tbrowse-text-subtle)' }}>hover a node…</span>}
      </div>
    </div>
  );
};

const TreeBody = ({
  data,
  visibleRows,
  rowRange,
  width,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  collapsedNodeIds,
  prunedNodeIds,
  swappedNodeIds,
  compressedNodeIds,
  searchResults,
  nodeOfInterestId,
  onHoverNode,
  onSelectNode,
  onClearSelection,
  onToggleCollapsed,
  onTogglePruned,
  onToggleSwapped,
  onToggleCompressed,
  onExpandSubtree,
  onMakeNodeOfInterest,
  onShowParalogs,
  onReroot,
  onRegrowOthers,
  zoneState,
}: ZoneRenderProps<TreeZoneState>) => {
  const prunedNodeStyle = zoneState.prunedNodeStyle ?? DEFAULT_PRUNED_STYLE;
  const showLeafExtensions = zoneState.showLeafExtensions ?? true;
  // Right gutter. With extensions on we keep the full RIGHT_PAD (room for the
  // dashes + collapsed triangles). With extensions off the dashes are gone, so
  // reclaim that space and let the tree run to the edge — but still reserve
  // the triangle width whenever a collapsed-summary row is actually present,
  // since its triangle extends right of the (right-aligned) apex.
  const hasCollapsedSummary = visibleRows.some((r) => r.kind === 'collapsedSummary');
  const rightPad = showLeafExtensions
    ? RIGHT_PAD
    : (hasCollapsedSummary ? COLLAPSED_TRIANGLE_WIDTH_MAX : MIN_RIGHT_PAD);
  const drawingWidth = Math.max(0, width - LEFT_PAD - rightPad);
  const svgRef = useRef<SVGSVGElement>(null);

  // Auto-compression: branches whose distance is more than 5× the median
  // are flagged for visual shortening so a single outlier doesn't squash
  // the rest of the tree. The user can override per-branch via the
  // tooltip; the override flips whatever the auto rule decided
  // (XOR semantics). The actual shortening happens later, in pixel space,
  // post-layout.
  const autoCompressEnabled = zoneState.autoCompressLongBranches ?? true;
  const autoCompressed = useMemo(() => {
    if (!autoCompressEnabled) return new Set<NodeId>();
    const distances: number[] = [];
    for (const n of Object.values(data.tree.nodes)) {
      if (n.parentId !== null && n.distance > 0) distances.push(n.distance);
    }
    if (distances.length < 5) return new Set<NodeId>();
    const sorted = [...distances].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) return new Set<NodeId>();
    const threshold = median * 5;
    const out = new Set<NodeId>();
    for (const n of Object.values(data.tree.nodes)) {
      if (n.parentId !== null && n.distance > threshold) out.add(n.id);
    }
    return out;
  }, [data.tree, autoCompressEnabled]);

  // Effective compression set = auto-detected XOR per-node overrides.
  const effectiveCompressed = useMemo(() => {
    const out = new Set<NodeId>(autoCompressed);
    for (const id of compressedNodeIds) {
      if (out.has(id)) out.delete(id);
      else out.add(id);
    }
    return out;
  }, [autoCompressed, compressedNodeIds]);

  // For the tooltip's "Compress / Uncompress branch" label we also need
  // to know whether a single node is currently compressed. Local helper.
  const isCompressed = (id: NodeId) => effectiveCompressed.has(id);

  // Per-node count of leaves in the subtree rooted at that node —
  // 1 for leaves, N for the root, monotonic on the way up. Drives
  // the per-branch thickness scaling: branches carrying many leaves
  // render thicker than branches that lead to a single tip. Walks
  // the tree once via parent pointers (O(leaves × depth)).
  const subtreeLeafCounts = useMemo(() => {
    const counts = new Map<NodeId, number>();
    for (const n of Object.values(data.tree.nodes)) {
      if (!n.isLeaf) continue;
      let cur: NodeId | null = n.id;
      while (cur !== null) {
        counts.set(cur, (counts.get(cur) ?? 0) + 1);
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
    }
    return counts;
  }, [data.tree]);

  // Shared count→size scale used by branch thickness AND collapsed-
  // triangle horizontal length. Both follow the same `1, 4, 16, 64`
  // leaf-count cutoffs (`BRANCH_WIDTH_LEAVES_PER_STEP = 4`,
  // `BRANCH_WIDTH_MAX_STEPS = 3`), mapped onto different output
  // ranges via `pxPerStep = (max − min) / MAX_STEPS`. So a 4-leaf
  // clade lands at `min + (max − min)/3`, a 16-leaf clade at
  // `min + 2(max − min)/3`, and a 64-leaf-or-more clade at `max`.
  // Total-tree-agnostic — a 16-leaf clade lands at the same step
  // in any tree.
  const sizeForCount = useMemo(() => {
    const denom = Math.log(BRANCH_WIDTH_LEAVES_PER_STEP);
    return (count: number, min: number, max: number): number => {
      if (count <= 1) return min;
      const stepsRaw = Math.log(count) / denom;
      const steps = Math.min(BRANCH_WIDTH_MAX_STEPS, stepsRaw);
      const pxPerStep = (max - min) / BRANCH_WIDTH_MAX_STEPS;
      return min + steps * pxPerStep;
    };
  }, []);

  // Map a node id to its branch thickness in [BRANCH_WIDTH_MIN,
  // BRANCH_WIDTH_MAX].
  const branchWidth = useMemo(
    () => (nodeId: NodeId) =>
      sizeForCount(
        subtreeLeafCounts.get(nodeId) ?? 1,
        BRANCH_WIDTH_MIN,
        BRANCH_WIDTH_MAX,
      ),
    [subtreeLeafCounts, sizeForCount],
  );

  // Map a node id to its collapsed-summary triangle horizontal
  // length in [COLLAPSED_TRIANGLE_WIDTH_MIN, COLLAPSED_TRIANGLE_WIDTH_MAX].
  // Triangles representing larger subtrees stretch further right.
  const triangleWidth = useMemo(
    () => (nodeId: NodeId) =>
      sizeForCount(
        subtreeLeafCounts.get(nodeId) ?? 1,
        COLLAPSED_TRIANGLE_WIDTH_MIN,
        COLLAPSED_TRIANGLE_WIDTH_MAX,
      ),
    [subtreeLeafCounts, sizeForCount],
  );

  // Per-internal-node count of matched leaves anywhere in its subtree.
  // Drives the badge on collapsed-summary triangles so the user can
  // tell "this triangle hides 3 matches" without expanding it.
  // O(matches × depth); cheap given the 10k-match cap.
  const subtreeMatchCounts = useMemo(() => {
    const counts = new Map<NodeId, number>();
    if (searchResults.matchedLeafIds.size === 0) return counts;
    for (const leafId of searchResults.matchedLeafIds) {
      let cur = data.tree.nodes[leafId]?.parentId ?? null;
      while (cur !== null) {
        counts.set(cur, (counts.get(cur) ?? 0) + 1);
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
    }
    return counts;
  }, [searchResults.matchedLeafIds, data.tree]);

  // Raw layout (no compression). Pixel positions come from branch-length
  // depth × xScale where xScale = drawingWidth / maxEndDepth.
  const rawLayout = useMemo(
    () =>
      computeTreeLayout({
        tree: data.tree,
        visibleRows,
        drawingLeftX: LEFT_PAD,
        drawingWidth,
        layoutMode: zoneState.layoutMode,
      }),
    [data.tree, visibleRows, drawingWidth, zoneState.layoutMode],
  );

  // Compression in pixel space. Each compressed branch is first shortened
  // to at most `0.1 × drawingWidth` pixels (never lengthened); descendants
  // shift left by the same amount so their relative geometry is preserved.
  // After compression, the layout is RESCALED so the rightmost visible
  // end-node still lands at `drawingLeftX + drawingWidth` — otherwise the
  // tree would leave whitespace on the right, and the leaf-extension
  // dashes would stretch across the gap to bridge the labels zone. The
  // 0.1 cap therefore acts as a *relative* shortening guideline rather
  // than a hard pixel limit.
  const layout = useMemo(() => {
    if (effectiveCompressed.size === 0 || drawingWidth <= 0) return rawLayout;
    const maxBranchPx = drawingWidth * 0.1;
    const byIdRaw = new Map(rawLayout.nodes.map((n) => [n.nodeId, n]));
    const childrenIdx = new Map<NodeId, NodeId[]>();
    for (const n of rawLayout.nodes) {
      if (n.parentId === null) continue;
      const arr = childrenIdx.get(n.parentId);
      if (arr) arr.push(n.nodeId);
      else childrenIdx.set(n.parentId, [n.nodeId]);
    }
    const newX = new Map<NodeId, number>();
    const queue: NodeId[] = [];
    if (rawLayout.rootId) {
      newX.set(rawLayout.rootId, byIdRaw.get(rawLayout.rootId)!.x);
      queue.push(rawLayout.rootId);
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const parentRawX = byIdRaw.get(id)!.x;
      const parentNewX = newX.get(id)!;
      for (const childId of childrenIdx.get(id) ?? []) {
        const child = byIdRaw.get(childId)!;
        const rawBranchPx = child.x - parentRawX;
        const branchPx = effectiveCompressed.has(childId)
          ? Math.min(rawBranchPx, maxBranchPx)
          : rawBranchPx;
        newX.set(childId, parentNewX + branchPx);
        queue.push(childId);
      }
    }
    // Rescale so the rightmost VISIBLE END (leaf or collapsed summary)
    // sits at the right edge of the drawing area, the same invariant
    // computeTreeLayout enforces for the raw layout.
    let maxEndX = LEFT_PAD;
    for (const n of rawLayout.nodes) {
      if (!n.isVisibleEnd) continue;
      const adj = newX.get(n.nodeId) ?? n.x;
      if (adj > maxEndX) maxEndX = adj;
    }
    const span = maxEndX - LEFT_PAD;
    const scale = span > 0 ? drawingWidth / span : 1;
    return {
      rootId: rawLayout.rootId,
      nodes: rawLayout.nodes.map((n) => {
        const adj = newX.get(n.nodeId) ?? n.x;
        return { ...n, x: LEFT_PAD + (adj - LEFT_PAD) * scale };
      }),
    };
  }, [rawLayout, effectiveCompressed, drawingWidth]);

  const ancestorsHighlight = useMemo<ReadonlySet<NodeId>>(() => {
    if (hoveredNodeId === null) return new Set();
    return ancestorIdsOf(data.tree, hoveredNodeId);
  }, [hoveredNodeId, data.tree]);

  const fullChildrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);

  // ─── Reroot-path compression ────────────────────────────────────
  // When the user has pruned the tree such that the root has a
  // single-child chain leading down to the first node with multiple
  // visible children (or a visible leaf / collapsed-summary), that
  // chain carries no information — it's just an empty spine. With
  // `rerootCompression` on (default), we collapse it to a fixed
  // visual width so the visible content gets the horizontal real
  // estate, and render the elided spine as a string of vertical
  // pipes that reads as `||||||||`. Compression only kicks in when
  // the chain's natural span exceeds `COMPRESSED_PATH_WIDTH`, so a
  // tree that already has a tight spine is left alone.
  const rerootCompressionEnabled = zoneState.rerootCompression ?? true;

  const rootCompression = useMemo<{
    /** First and last node of the chain (root → effective root). */
    chain: NodeId[];
    /** Branches that should not render — every chain edge. */
    branchSkip: ReadonlySet<NodeId>;
    /** Internal-node glyphs that should not render — intermediate
     *  chain nodes only; root and effective root keep their glyphs. */
    glyphSkip: ReadonlySet<NodeId>;
    /** Layout-node array with the effective root + descendants
     *  shifted left so the chain occupies a fixed
     *  `COMPRESSED_PATH_WIDTH` instead of its natural span. */
    nodes: TreeLayoutNode[];
  } | null>(() => {
    if (!rerootCompressionEnabled) return null;
    if (!layout.rootId) return null;

    const layoutById = new Map<NodeId, TreeLayoutNode>();
    const childrenIndex = new Map<NodeId, NodeId[]>();
    for (const n of layout.nodes) {
      layoutById.set(n.nodeId, n);
      if (n.parentId === null) continue;
      let arr = childrenIndex.get(n.parentId);
      if (!arr) {
        arr = [];
        childrenIndex.set(n.parentId, arr);
      }
      arr.push(n.nodeId);
    }
    // Walk down from root following only-child edges, stopping at
    // the first fork or visible end.
    const chain: NodeId[] = [];
    let cur: NodeId | null = layout.rootId;
    while (cur !== null) {
      const node = layoutById.get(cur);
      if (!node) break;
      chain.push(cur);
      if (node.isVisibleEnd) break;
      const kids = childrenIndex.get(cur);
      if (!kids || kids.length !== 1) break;
      cur = kids[0];
    }
    if (chain.length <= 1) return null;

    const root = layoutById.get(chain[0]);
    const effRoot = layoutById.get(chain[chain.length - 1]);
    if (!root || !effRoot) return null;
    const naturalSpan = effRoot.x - root.x;
    if (naturalSpan <= COMPRESSED_PATH_WIDTH) return null;
    const shift = naturalSpan - COMPRESSED_PATH_WIDTH;

    // Effective root + descendants — these all shift left, then
    // get rescaled outward so the visible subtree fills the now-
    // freed horizontal space rather than ending halfway across the
    // drawing area.
    const subtree = new Set<NodeId>([effRoot.nodeId]);
    const queue: NodeId[] = [effRoot.nodeId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const k of childrenIndex.get(id) ?? []) {
        if (subtree.has(k)) continue;
        subtree.add(k);
        queue.push(k);
      }
    }
    // Where the subtree's right edge currently lands after the
    // shift, and where we want it after the rescale: at the same
    // place the rightmost visible end was BEFORE compression
    // (i.e. drawingLeftX + drawingWidth as the previous layout
    // memo positioned it). Compute scale relative to the shifted
    // subtree's natural span from the effective root.
    let preRescaleMax = -Infinity;
    for (const n of layout.nodes) {
      if (!subtree.has(n.nodeId)) continue;
      if (!n.isVisibleEnd) continue;
      // (n.x - shift) is the post-shift x; we need the rescale to
      // stretch from (effRoot.x - shift) to drawingLeftX +
      // drawingWidth, so collect post-shift x values here.
      const x = n.x - shift;
      if (x > preRescaleMax) preRescaleMax = x;
    }
    const effRootShiftedX = effRoot.x - shift;
    const targetMaxX = LEFT_PAD + drawingWidth;
    const preSpan = preRescaleMax - effRootShiftedX;
    const targetSpan = targetMaxX - effRootShiftedX;
    // Scale factor of 1 leaves the subtree alone; > 1 stretches it
    // outward to fill the freed space; clamp at 1 if anything
    // numerical goes weird (shouldn't happen but cheap to guard).
    const subtreeScale =
      preSpan > 0 && targetSpan > 0 ? targetSpan / preSpan : 1;
    const intermediateChain = new Set(chain.slice(1, -1));
    const nodes = layout.nodes.map((n) => {
      if (subtree.has(n.nodeId)) {
        const shiftedX = n.x - shift;
        const stretchedX =
          effRootShiftedX + (shiftedX - effRootShiftedX) * subtreeScale;
        return { ...n, x: stretchedX };
      }
      if (intermediateChain.has(n.nodeId))
        return { ...n, x: effRootShiftedX };
      return n;
    });
    return {
      chain,
      branchSkip: new Set(chain.slice(1)),
      glyphSkip: intermediateChain,
      nodes,
    };
  }, [layout, rerootCompressionEnabled, drawingWidth]);

  const compressedNodes = rootCompression?.nodes ?? layout.nodes;
  const compressedBranchSkip: ReadonlySet<NodeId> =
    rootCompression?.branchSkip ?? EMPTY_NODE_ID_SET;
  const compressedGlyphSkip: ReadonlySet<NodeId> =
    rootCompression?.glyphSkip ?? EMPTY_NODE_ID_SET;
  const compressibleChain = rootCompression?.chain ?? null;
  // ─────────────────────────────────────────────────────────────────

  const byId = useMemo(() => {
    const m = new Map<string, TreeLayoutNode>();
    for (const n of compressedNodes) m.set(n.nodeId, n);
    return m;
  }, [compressedNodes]);

  // Per-node opacity for the animation pipeline. Visible-end rows (leaves
  // and collapsed-summaries) carry an opacity hint via visibleRows; an
  // internal node inherits the max opacity of any visible-end in its
  // subtree, so branches in a fading subtree all fade together.
  const opacityById = useMemo(() => {
    const m = new Map<NodeId, number>();
    for (const n of layout.nodes) m.set(n.nodeId, 0);
    for (const r of visibleRows) m.set(r.nodeId, r.opacity ?? 1);
    for (const r of visibleRows) {
      const op = r.opacity ?? 1;
      let cur: NodeId | null = data.tree.nodes[r.nodeId]?.parentId ?? null;
      while (cur !== null) {
        if (!m.has(cur)) break;
        const curOp = m.get(cur) ?? 0;
        if (op > curOp) m.set(cur, op);
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
    }
    return m;
  }, [layout, visibleRows, data.tree]);

  // Pruned-node stub glyphs: one per pruned id, placed adjacent to its
  // anchor's branch at a small fixed offset. The side (above or below) is
  // chosen to match where the pruned branch came from — and where it will
  // regrow back to — based on its position in the anchor's original
  // children list.
  const prunedStubs = useMemo(() => {
    // Group pruned ids by closest visible ancestor.
    const byAnchor = new Map<NodeId, NodeId[]>();
    for (const prunedId of prunedNodeIds) {
      let cur: NodeId | null = data.tree.nodes[prunedId]?.parentId ?? null;
      while (cur !== null && !byId.has(cur)) {
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
      if (cur === null) continue;
      let arr = byAnchor.get(cur);
      if (!arr) {
        arr = [];
        byAnchor.set(cur, arr);
      }
      arr.push(prunedId);
    }

    type Stub = {
      prunedId: NodeId;
      anchorX: number;
      anchorY: number;
      stubY: number;
      markX: number;
      markY: number;
      /** Leaf count of the pruned subtree — surfaced by the "count"
       *  terminal-mark style. Does NOT influence stub geometry. */
      leafCount: number;
      /** Stroke width for the L-connector. Fixed across every stub
       *  (`PRUNED_STUB_WIDTH`); pruned stubs are deliberately not
       *  scaled by clade size. */
      strokeWidth: number;
    };
    const stubs: Stub[] = [];

    for (const [anchorId, ids] of byAnchor) {
      const anchor = byId.get(anchorId);
      if (!anchor) continue;

      // Swap inverts the visual order of children, so the "side" a pruned
      // branch sits on flips when the anchor is swapped.
      const rawChildren = fullChildrenIndex.get(anchorId) ?? [];
      const fullChildren = swappedNodeIds.has(anchorId)
        ? [...rawChildren].reverse()
        : rawChildren;
      const visibleIndices: number[] = [];
      fullChildren.forEach((cid, idx) => {
        if (byId.has(cid)) visibleIndices.push(idx);
      });
      // Avg index of visible siblings — split point between "above" and "below".
      const visibleAvg =
        visibleIndices.length > 0
          ? visibleIndices.reduce((a, b) => a + b, 0) / visibleIndices.length
          : 0;

      type Tagged = { prunedId: NodeId; baIdx: number; above: boolean };
      const tagged: Tagged[] = ids.map((prunedId) => {
        // Walk up from prunedId until parent === anchor; cur ends up as the
        // direct child of anchor on the path to prunedId (the "branch
        // ancestor").
        let cur: NodeId = prunedId;
        let parent: NodeId | null =
          data.tree.nodes[prunedId]?.parentId ?? null;
        while (parent !== null && parent !== anchorId) {
          cur = parent;
          parent = data.tree.nodes[parent]?.parentId ?? null;
        }
        const baIdx = fullChildren.indexOf(cur);
        // Below visibleAvg → branch came from above the anchor (lower-index
        // siblings sit higher in the tree visualization). Tie → below.
        const above = baIdx >= 0 && baIdx < visibleAvg;
        return { prunedId, baIdx, above };
      });

      // Stack stubs on each side, stacking outward by sibling order so the
      // ones farthest from the visible siblings end up farthest from the
      // anchor.
      const aboveSide = tagged
        .filter((t) => t.above)
        .sort((a, b) => b.baIdx - a.baIdx);
      const belowSide = tagged
        .filter((t) => !t.above)
        .sort((a, b) => a.baIdx - b.baIdx);

      // Place every stub on a side at the SAME fixed offset from
      // the anchor branch — markers don't stack. Multiple prunes
      // at the same anchor on the same side render their markers
      // overlapping at one position (one click target wins, the
      // others paint underneath). This keeps the visualisation
      // uniform regardless of how many subtrees are pruned, and
      // prevents the row from blooming vertically into the next
      // row's space when many siblings get cut at once.
      const stackSide = (side: typeof tagged, sign: 1 | -1) => {
        for (const t of side) {
          const leafCount = countLeavesInSubtree(
            t.prunedId,
            data.tree,
            fullChildrenIndex,
          );
          const stubY = anchor.y + sign * PRUNED_STUB_GAP;
          const markX = anchor.x + PRUNED_STUB_LEN;
          stubs.push({
            prunedId: t.prunedId,
            anchorX: anchor.x,
            anchorY: anchor.y,
            stubY,
            markX,
            markY: stubY,
            leafCount,
            strokeWidth: PRUNED_STUB_WIDTH,
          });
        }
      };
      stackSide(aboveSide, -1);
      stackSide(belowSide, 1);
    }
    return stubs;
  }, [
    prunedNodeIds,
    data.tree,
    byId,
    fullChildrenIndex,
    swappedNodeIds,
  ]);

  const isHighlighted = (nodeId: NodeId): boolean =>
    hoveredSubtreeIds.has(nodeId) || ancestorsHighlight.has(nodeId);

  // Would pruning the selected node empty the tree (no active leaves left)?
  // An active leaf is one whose ancestor chain contains no pruned node. The
  // prune button is disabled in that case (regrow is always allowed).
  const pruneWouldEmptyTree = useMemo(() => {
    if (selectedNodeId === null) return false;
    if (prunedNodeIds.has(selectedNodeId)) return false;
    const node = data.tree.nodes[selectedNodeId];
    if (!node) return false;
    // Collect the selected node's subtree (the would-be-pruned set).
    const subtree = new Set<NodeId>();
    const stack: NodeId[] = [selectedNodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (subtree.has(id)) continue;
      subtree.add(id);
      const kids = fullChildrenIndex.get(id);
      if (kids) for (const k of kids) stack.push(k);
    }
    // Look for any active leaf outside that subtree.
    for (const n of Object.values(data.tree.nodes)) {
      if (!n.isLeaf) continue;
      if (subtree.has(n.id)) continue;
      let cur: NodeId | null = n.id;
      let blocked = false;
      while (cur !== null) {
        if (prunedNodeIds.has(cur)) {
          blocked = true;
          break;
        }
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
      if (!blocked) return false;
    }
    return true;
  }, [selectedNodeId, prunedNodeIds, fullChildrenIndex, data.tree]);

  // For the tooltip's "Expand all" affordance: does the selected node's
  // subtree contain any currently-collapsed internal node? Only relevant
  // when the selected node itself is internal and not currently collapsed.
  // Hooked here (rather than later, near the tooltip-related locals) so it
  // sits BEFORE any conditional early return — React requires every render
  // to call the same hooks in the same order.
  const selectedHasCollapsedDescendants = useMemo(() => {
    if (selectedNodeId === null) return false;
    const node = data.tree.nodes[selectedNodeId];
    if (!node || node.isLeaf) return false;
    if (collapsedNodeIds.has(selectedNodeId)) return false;
    if (collapsedNodeIds.size === 0) return false;
    const stack: NodeId[] = [...(fullChildrenIndex.get(selectedNodeId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (collapsedNodeIds.has(id)) return true;
      const kids = fullChildrenIndex.get(id);
      if (kids) for (const k of kids) stack.push(k);
    }
    return false;
  }, [selectedNodeId, data.tree, collapsedNodeIds, fullChildrenIndex]);

  // For the tooltip's "Prune others / Regrow others" toggle: are any of
  // the sibling-branch top-level nodes between the selected node and the
  // root currently pruned? Determines which label the button shows.
  const selectedOthersArePruned = useMemo(() => {
    if (selectedNodeId === null) return false;
    if (prunedNodeIds.size === 0) return false;
    const path = new Set<NodeId>();
    let cur: NodeId | null = selectedNodeId;
    while (cur !== null) {
      path.add(cur);
      cur = data.tree.nodes[cur]?.parentId ?? null;
    }
    if (path.size <= 1) return false;
    for (const ancestorId of path) {
      if (ancestorId === selectedNodeId) continue;
      const kids = fullChildrenIndex.get(ancestorId);
      if (!kids) continue;
      for (const k of kids) {
        if (!path.has(k) && prunedNodeIds.has(k)) return true;
      }
    }
    return false;
  }, [selectedNodeId, data.tree, fullChildrenIndex, prunedNodeIds]);

  if (layout.nodes.length === 0) return null;

  const totalHeight =
    visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
      : 0;

  const extensionEndX = width - 1;

  // Virtualization: only render branches/glyphs that intersect the visible
  // y-range. The chassis already supplies rowRange (with its own overscan).
  // For branches we use range overlap because a branch's vertical segment
  // can span y values outside both endpoints' rows.
  const firstVisibleRow = visibleRows[Math.max(0, rowRange.startIndex)];
  const lastVisibleRow =
    visibleRows[Math.max(0, Math.min(visibleRows.length - 1, rowRange.endIndex - 1))];
  const visibleStartY = firstVisibleRow ? firstVisibleRow.y : 0;
  const visibleEndY = lastVisibleRow
    ? lastVisibleRow.y + lastVisibleRow.height
    : totalHeight;

  const yInRange = (y: number) => y >= visibleStartY && y <= visibleEndY;
  const branchInRange = (parentY: number, childY: number) => {
    const lo = parentY < childY ? parentY : childY;
    const hi = parentY < childY ? childY : parentY;
    return hi >= visibleStartY && lo <= visibleEndY;
  };

  // The tooltip needs a (x, y) anchor for any selected node. Visible nodes
  // come from the layout; pruned nodes don't appear in the layout, so we
  // synthesize an anchor at their stub mark position.
  const selectedTreeNode =
    selectedNodeId !== null ? data.tree.nodes[selectedNodeId] : null;
  let selectedLayoutNode: TreeLayoutNode | null =
    selectedNodeId !== null ? (byId.get(selectedNodeId) ?? null) : null;
  if (!selectedLayoutNode && selectedNodeId !== null && prunedNodeIds.has(selectedNodeId)) {
    const stub = prunedStubs.find((s) => s.prunedId === selectedNodeId);
    if (stub && selectedTreeNode) {
      selectedLayoutNode = {
        nodeId: selectedNodeId,
        parentId: selectedTreeNode.parentId,
        x: stub.markX,
        y: stub.markY,
        isVisibleEnd: false,
        isLeaf: selectedTreeNode.isLeaf,
        isCollapsedSummary: false,
      };
    }
  }

  const selectedSubtreeLeafCount =
    selectedNodeId !== null && selectedTreeNode && !selectedTreeNode.isLeaf
      ? countLeavesInSubtree(selectedNodeId, data.tree, fullChildrenIndex)
      : 0;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={totalHeight}
        style={{ display: 'block', shapeRendering: 'crispEdges' }}
        onMouseLeave={() => onHoverNode(null)}
      >
        {/* Background hit rect — clicks here clear selection. Sits at the
            bottom of the z-order; all interactive elements below cover it. */}
        <rect
          x={0}
          y={0}
          width={width}
          height={totalHeight}
          fill="transparent"
          onClick={onClearSelection}
        />
        {/* Row hit areas. Full-row click target for each visible end so
            hovering anywhere in the row outside the branch still hits. */}
        <g>
          {compressedNodes.map((n) => {
            if (!n.isVisibleEnd) return null;
            const r = visibleRows.find((row) => row.nodeId === n.nodeId);
            if (!r) return null;
            if (!yInRange(r.y)) return null;
            return (
              <rect
                key={`row-${n.nodeId}`}
                x={0}
                y={r.y}
                width={width}
                height={r.height}
                fill="transparent"
                onMouseEnter={() => onHoverNode(n.nodeId)}
                onClick={() => onSelectNode(n.nodeId)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </g>
        {/* Root stub: a short horizontal segment to the left of the root so
            the root node has something visible to hover and click. */}
        {(() => {
          if (!layout.rootId) return null;
          const root = byId.get(layout.rootId);
          if (!root) return null;
          if (!yInRange(root.y)) return null;
          const hl = isHighlighted(root.nodeId);
          const w = branchWidth(root.nodeId);
          return (
            <line
              key="b-root"
              x1={root.x - ROOT_STUB_LEN}
              y1={root.y}
              x2={root.x}
              y2={root.y}
              stroke={hl ? HIGHLIGHT_COLOR : BRANCH_COLOR}
              strokeWidth={hl ? w + BRANCH_WIDTH_HIGHLIGHT_BUMP : w}
              strokeLinecap="round"
              pointerEvents="none"
            />
          );
        })()}
        {/* Visible branches. During animation a fading-out child retracts
            toward its parent (right→left for collapse/prune) and a
            fading-in child extends from its parent (left→right for
            expand/regrow). The parent end stays anchored. */}
        <g pointerEvents="none">
          {compressedNodes.map((child) => {
            if (child.parentId === null) return null;
            // Skip the chain branches — they're collectively replaced
            // by the compressed-path bars glyph drawn below.
            if (compressedBranchSkip.has(child.nodeId)) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!branchInRange(parent.y, child.y)) return null;
            const opacity = opacityById.get(child.nodeId) ?? 1;
            const childX = parent.x + (child.x - parent.x) * opacity;
            const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${childX} ${child.y}`;
            const hl = isHighlighted(child.nodeId);
            const w = branchWidth(child.nodeId);
            return (
              <path
                key={`b-${child.nodeId}`}
                d={d}
                stroke={hl ? HIGHLIGHT_COLOR : BRANCH_COLOR}
                strokeWidth={hl ? w + BRANCH_WIDTH_HIGHLIGHT_BUMP : w}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
                opacity={opacity}
              />
            );
          })}
        </g>
        {/* Compressed root-path glyph: when an unbranched chain of
            internal nodes runs from the actual root down to the
            effective root, the chain's branches are skipped above
            and replaced here with a string of vertical pipes. */}
        {compressibleChain &&
          (() => {
            const root = byId.get(compressibleChain[0]);
            const effRoot = byId.get(
              compressibleChain[compressibleChain.length - 1],
            );
            if (!root || !effRoot) return null;
            if (!yInRange(root.y)) return null;
            const startX = root.x;
            const endX = effRoot.x;
            const span = endX - startX;
            if (span <= 0) return null;
            const margin = 2;
            const innerSpan = Math.max(0, span - 2 * margin);
            const spacing =
              COMPRESSED_PATH_BAR_COUNT > 1
                ? innerSpan / (COMPRESSED_PATH_BAR_COUNT - 1)
                : 0;
            const half = COMPRESSED_PATH_BAR_HEIGHT / 2;
            return (
              <g pointerEvents="none">
                {Array.from({ length: COMPRESSED_PATH_BAR_COUNT }).map(
                  (_, i) => {
                    const x = startX + margin + i * spacing;
                    return (
                      <line
                        key={`crp-${i}`}
                        x1={x}
                        y1={root.y - half}
                        x2={x}
                        y2={root.y + half}
                        stroke={BRANCH_COLOR}
                        strokeWidth={1.25}
                        strokeLinecap="round"
                      />
                    );
                  },
                )}
              </g>
            );
          })()}
        {/* Branch-compression glyphs. Two short diagonal slashes ("//") at
            the midpoint of each compressed horizontal segment, signalling
            that the rendered length is shorter than the actual branch
            length. Drawn after the branches so they overlay the line. */}
        <g pointerEvents="none">
          {compressedNodes.map((child) => {
            if (child.parentId === null) return null;
            if (compressedBranchSkip.has(child.nodeId)) return null;
            if (!effectiveCompressed.has(child.nodeId)) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!yInRange(child.y)) return null;
            const opacity = opacityById.get(child.nodeId) ?? 1;
            const childX = parent.x + (child.x - parent.x) * opacity;
            const midX = (parent.x + childX) / 2;
            const hl = isHighlighted(child.nodeId);
            const stroke = hl ? HIGHLIGHT_COLOR : BRANCH_COLOR;
            // Two diagonal slashes 3px apart, ±3px tall.
            return (
              <g key={`bc-${child.nodeId}`} opacity={opacity}>
                <line
                  x1={midX - 3}
                  y1={child.y + 3}
                  x2={midX}
                  y2={child.y - 3}
                  stroke={stroke}
                  strokeWidth={1.2}
                />
                <line
                  x1={midX}
                  y1={child.y + 3}
                  x2={midX + 3}
                  y2={child.y - 3}
                  stroke={stroke}
                  strokeWidth={1.2}
                />
              </g>
            );
          })}
        </g>
        {/* Leaf extensions. Tracked to the leaf's interpolated x so the
            extension visibly anchors to where the branch tip currently is.
            For collapsed-summary nodes the extension starts past the
            triangle's base. Suppressed when showLeafExtensions is false. */}
        <g pointerEvents="none">
          {showLeafExtensions && compressedNodes.map((n) => {
            if (!n.isVisibleEnd) return null;
            if (!yInRange(n.y)) return null;
            const hl = isHighlighted(n.nodeId);
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const tipX = parent
              ? parent.x + (n.x - parent.x) * opacity
              : n.x;
            const extStart = n.isCollapsedSummary
              ? tipX + triangleWidth(n.nodeId)
              : tipX;
            if (extStart >= extensionEndX) return null;
            return (
              <line
                key={`e-${n.nodeId}`}
                x1={extStart}
                y1={n.y}
                x2={extensionEndX}
                y2={n.y}
                stroke={hl ? EXTENSION_HIGHLIGHT_COLOR : EXTENSION_COLOR}
                strokeWidth={hl ? 1.5 : 1}
                strokeDasharray="2 3"
                opacity={opacity}
              />
            );
          })}
        </g>
        {/* Collapsed-summary triangles. Apex at the (interpolated) branch
            tip; base extends right by `triangleWidth(nodeId)` — same
            count→size scale that drives branch thickness, mapped onto
            [COLLAPSED_TRIANGLE_WIDTH_MIN, COLLAPSED_TRIANGLE_WIDTH_MAX]
            so larger subtrees get longer triangles. Vertical base
            height scales (logarithmically) with the subtree's leaf
            count, capped to fit within a single row. Triangles whose
            subtree contains search matches get the search-match stroke
            colour and a small count badge to the right of the base. */}
        <g pointerEvents="none">
          {compressedNodes.map((n) => {
            if (!n.isCollapsedSummary) return null;
            if (!yInRange(n.y)) return null;
            const row = visibleRows.find((r) => r.nodeId === n.nodeId);
            if (!row) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const apexX = parent
              ? parent.x + (n.x - parent.x) * opacity
              : n.x;
            const baseX = apexX + triangleWidth(n.nodeId);
            const h = collapsedTriangleHeight(row.leafCount);
            const top = n.y - h / 2;
            const bot = n.y + h / 2;
            const matchCount = subtreeMatchCounts.get(n.nodeId) ?? 0;
            // Triangle border thickness follows the same count-driven
            // curve as branch lines (1, 4, 16, 64 leaves → 1, 2, 3, 4
            // px), so a collapsed clade's outline reads as a fatter
            // continuation of the branch leading into it. When the
            // subtree contains search matches, the border picks up
            // the search-match colour and a small `+0.75 px` bump so
            // the highlight is still visually distinct.
            const triW = branchWidth(n.nodeId);
            return (
              <g key={`c-${n.nodeId}`} opacity={opacity}>
                <polygon
                  points={`${apexX},${n.y} ${baseX},${top} ${baseX},${bot}`}
                  fill={COLLAPSED_TRIANGLE_FILL}
                  stroke={
                    matchCount > 0
                      ? SEARCH_MATCH_COLOR
                      : COLLAPSED_TRIANGLE_STROKE
                  }
                  strokeWidth={matchCount > 0 ? triW + 0.75 : triW}
                  strokeLinejoin="round"
                >
                  <title>
                    {matchCount > 0
                      ? `Collapsed (${row.leafCount} leaves, ${matchCount} matching)`
                      : `Collapsed (${row.leafCount} leaves)`}
                  </title>
                </polygon>
                {matchCount > 0 && (
                  <text
                    x={baseX + 3}
                    y={n.y + 3}
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill={SEARCH_MATCH_COLOR}
                  >
                    {matchCount}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Internal-node glyphs. Speciation → small filled circle;
            duplication → small filled square. Position tracks the branch
            tip during collapse/expand/prune/regrow animations so the
            glyph sits at the visible bend even mid-animation. */}
        <g pointerEvents="none">
          {compressedNodes.map((n) => {
            if (n.isLeaf) return null;
            if (n.isVisibleEnd) return null; // collapsed-summary; render its own marker if needed elsewhere
            // Don't render glyphs for the intermediate compressed-
            // away chain nodes — they're behind the bars.
            if (compressedGlyphSkip.has(n.nodeId)) return null;
            if (!yInRange(n.y)) return null;
            const treeNode = data.tree.nodes[n.nodeId];
            if (!treeNode) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const glyphX = parent ? parent.x + (n.x - parent.x) * opacity : n.x;
            const finalOpacity = opacity;
            const isDuplication = treeNode.eventType === 'duplication';
            if (isDuplication) {
              return (
                <rect
                  key={`g-${n.nodeId}`}
                  x={glyphX - NODE_GLYPH_SQUARE / 2}
                  y={n.y - NODE_GLYPH_SQUARE / 2}
                  width={NODE_GLYPH_SQUARE}
                  height={NODE_GLYPH_SQUARE}
                  fill={DUPLICATION_COLOR}
                  opacity={finalOpacity}
                >
                  <title>{`duplication${treeNode.bootstrap !== undefined ? ` · bootstrap ${treeNode.bootstrap}` : ''}`}</title>
                </rect>
              );
            }
            return (
              <circle
                key={`g-${n.nodeId}`}
                cx={glyphX}
                cy={n.y}
                r={NODE_GLYPH_RADIUS}
                fill={SPECIATION_COLOR}
                opacity={finalOpacity}
              >
                <title>{`${treeNode.eventType ?? 'speciation'}${treeNode.bootstrap !== undefined ? ` · bootstrap ${treeNode.bootstrap}` : ''}`}</title>
              </circle>
            );
          })}
        </g>
        {/* Leaf-node glyphs. Small filled circle in the branch colour at
            each visible leaf's branch tip, tracking the same interpolated
            x as the leaf-extension start so it slides smoothly during
            collapse / expand / prune / regrow animations. Search-matched
            leaves additionally get an outer ring in the search-match
            colour so they pop against the rest of the tree. */}
        <g pointerEvents="none">
          {compressedNodes.map((n) => {
            if (!n.isLeaf) return null;
            if (n.isCollapsedSummary) return null;
            if (!yInRange(n.y)) return null;
            const treeNode = data.tree.nodes[n.nodeId];
            if (!treeNode) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const tipX = parent ? parent.x + (n.x - parent.x) * opacity : n.x;
            const finalOpacity = opacity;
            const isSearchMatch = searchResults.matchedLeafIds.has(n.nodeId);
            return (
              <g key={`l-${n.nodeId}`} opacity={finalOpacity}>
                {isSearchMatch && (
                  <circle
                    cx={tipX}
                    cy={n.y}
                    r={SEARCH_MATCH_RING_RADIUS}
                    fill="none"
                    stroke={SEARCH_MATCH_COLOR}
                    strokeWidth={SEARCH_MATCH_RING_WIDTH}
                  />
                )}
                <circle
                  cx={tipX}
                  cy={n.y}
                  r={LEAF_GLYPH_RADIUS}
                  fill={BRANCH_COLOR}
                >
                  <title>{treeNode.geneId ?? n.nodeId}</title>
                </circle>
              </g>
            );
          })}
        </g>
        {/* Selection marker. Skipped for pruned nodes — those already
            highlight via the stub's own selected-state colour, and an
            extra circle on top would obscure the marker glyph. */}
        {selectedLayoutNode &&
          selectedNodeId !== null &&
          !prunedNodeIds.has(selectedNodeId) && (
            <circle
              cx={selectedLayoutNode.x}
              cy={selectedLayoutNode.y}
              r={SELECT_RADIUS}
              fill={SELECT_COLOR}
              stroke="white"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          )}
        {/* Branch hit areas. Top of stack so they win over row rects on
            overlaps. */}
        <g>
          {layout.rootId &&
            (() => {
              const root = byId.get(layout.rootId);
              if (!root) return null;
              if (!yInRange(root.y)) return null;
              return (
                <line
                  key="h-root"
                  x1={root.x - ROOT_STUB_LEN}
                  y1={root.y}
                  x2={root.x}
                  y2={root.y}
                  stroke="transparent"
                  strokeWidth={HIT_STROKE_WIDTH}
                  onMouseEnter={() => onHoverNode(root.nodeId)}
                  onClick={() => onSelectNode(root.nodeId)}
                  style={{ cursor: 'pointer' }}
                />
              );
            })()}
          {compressedNodes.map((child) => {
            if (child.parentId === null) return null;
            // Chain branches are not drawn — don't expose hit areas
            // for them either; the bars glyph is non-interactive.
            if (compressedBranchSkip.has(child.nodeId)) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!branchInRange(parent.y, child.y)) return null;
            const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${child.x} ${child.y}`;
            return (
              <path
                key={`h-${child.nodeId}`}
                d={d}
                stroke="transparent"
                strokeWidth={HIT_STROKE_WIDTH}
                fill="none"
                onMouseEnter={() => onHoverNode(child.nodeId)}
                onClick={() => onSelectNode(child.nodeId)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </g>
        {/* Pruned-branch stub glyphs. Rendered LAST so they sit above the
            branch hit paths in the SVG z-order and reliably capture clicks.
            One glyph per pruned id; each draws a tiny dashed stump where
            its branch was sheared off, pointing in the original branch's
            direction. The stub's y comes from the shadow layout so when
            the user regrows, the new branch lands at the same y the stub
            was indicating. */}
        <g>
          {prunedStubs.map((stub) => {
            if (!yInRange(stub.markY) && !yInRange(stub.anchorY)) return null;
            const isSelected = selectedNodeId === stub.prunedId;
            return (
              <g
                key={`pstub-${stub.prunedId}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(stub.prunedId);
                }}
              >
                {renderPrunedStub(prunedNodeStyle, stub, isSelected)}
                {/* Forgiving transparent click target. Centered on the
                    marker; same r across styles for consistent feel. */}
                <circle cx={stub.markX} cy={stub.markY} r={9} fill="transparent" />
                <title>{`Click to inspect pruned subtree (${stub.prunedId})`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      {selectedLayoutNode && selectedTreeNode && selectedNodeId !== null && (
        <Tooltip
          svgRef={svgRef}
          layoutNode={selectedLayoutNode}
          treeNode={selectedTreeNode}
          data={data}
          isCollapsed={collapsedNodeIds.has(selectedNodeId)}
          isPruned={prunedNodeIds.has(selectedNodeId)}
          isCompressed={isCompressed(selectedNodeId)}
          isNodeOfInterest={nodeOfInterestId === selectedNodeId}
          subtreeLeafCount={selectedSubtreeLeafCount}
          hasCollapsedDescendants={selectedHasCollapsedDescendants}
          pruneWouldEmptyTree={pruneWouldEmptyTree}
          onClose={onClearSelection}
          onToggleCollapsed={onToggleCollapsed}
          onTogglePruned={onTogglePruned}
          onToggleSwapped={onToggleSwapped}
          onToggleCompressed={onToggleCompressed}
          onExpandSubtree={onExpandSubtree}
          onMakeNodeOfInterest={onMakeNodeOfInterest}
          onShowParalogs={onShowParalogs}
          onReroot={onReroot}
          onRegrowOthers={onRegrowOthers}
          othersArePruned={selectedOthersArePruned}
        />
      )}
    </>
  );
};

/**
 * Render the connector + terminal-mark for a single pruned stub in the
 * given style. The connector goes from the anchor branch down/up to a
 * horizontal stub at `stubY`, and the marker sits at (markX, markY).
 *
 * Each branch of the switch is independent; styles are easy to add or tweak.
 */
function renderPrunedStub(
  style: PrunedNodeStyle,
  stub: {
    prunedId: NodeId;
    anchorX: number;
    anchorY: number;
    stubY: number;
    markX: number;
    markY: number;
    leafCount: number;
    strokeWidth: number;
  },
  isSelected: boolean,
) {
  const stroke = isSelected ? HIGHLIGHT_COLOR : '#888';
  const fill = isSelected ? HIGHLIGHT_COLOR : 'white';
  const text = isSelected ? HIGHLIGHT_COLOR : '#666';
  // Solid L-connector — vertical from the anchor branch to
  // `stubY`, then horizontal out to `markX`. Stroke width tracks
  // the pruned subtree's leaf count via `branchWidth` (same `1,
  // 4, 16, 64` cutoff curve as live branches). The horizontal arm
  // is fixed-length (`PRUNED_STUB_LEN`); the vertical arm grows
  // with stack offset so multiple stubs on one side cascade
  // outward along the anchor's vertical axis.
  const connector = (
    <path
      d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${stub.markX} ${stub.stubY}`}
      fill="none"
      stroke={stroke}
      strokeWidth={stub.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
  const mx = stub.markX;
  const my = stub.markY;
  switch (style) {
    case 'square':
      return (
        <>
          {connector}
          <rect
            x={mx - 3}
            y={my - 3}
            width={6}
            height={6}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </>
      );
    case 'triangle':
      // Left-pointing isosceles triangle; apex on the left, base on the
      // right — same orientation as the live collapsed-clade triangles.
      return (
        <>
          {connector}
          <polygon
            points={`${mx - 3},${my} ${mx + 3},${my - 3} ${mx + 3},${my + 3}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={0.6}
            pointerEvents="none"
          />
        </>
      );
    case 'cap':
      // Dashed L ending in a short vertical "⊣" cap. No terminal glyph.
      return (
        <>
          {connector}
          <line
            x1={mx}
            y1={my - 4}
            x2={mx}
            y2={my + 4}
            stroke={stroke}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </>
      );
    case 'slash':
      return (
        <>
          {connector}
          <rect
            x={mx - 3}
            y={my - 3}
            width={6}
            height={6}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <line
            x1={mx - 3}
            y1={my + 3}
            x2={mx + 3}
            y2={my - 3}
            stroke={stroke}
            strokeWidth={1.2}
            pointerEvents="none"
          />
        </>
      );
    case 'scissors':
      // Two short crossed strokes forming an "x".
      return (
        <>
          {connector}
          <line
            x1={mx - 3}
            y1={my - 3}
            x2={mx + 3}
            y2={my + 3}
            stroke={stroke}
            strokeWidth={1.4}
            pointerEvents="none"
          />
          <line
            x1={mx - 3}
            y1={my + 3}
            x2={mx + 3}
            y2={my - 3}
            stroke={stroke}
            strokeWidth={1.4}
            pointerEvents="none"
          />
        </>
      );
    case 'ellipsis':
      return (
        <>
          {connector}
          <rect
            x={mx - 6}
            y={my - 4}
            width={12}
            height={8}
            rx={2}
            ry={2}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <text
            x={mx}
            y={my + 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill={text}
            pointerEvents="none"
          >
            …
          </text>
        </>
      );
    case 'ghost':
      // Faint hollow rounded square with low opacity.
      return (
        <g opacity={0.45}>
          {connector}
          <rect
            x={mx - 4}
            y={my - 4}
            width={8}
            height={8}
            rx={2}
            ry={2}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </g>
      );
    case 'minitree':
      // 3-prong tree silhouette: a vertical stem with three horizontal
      // prongs branching off, all in a ~10x10 box.
      return (
        <>
          {connector}
          <g pointerEvents="none">
            <line x1={mx - 3} y1={my} x2={mx + 1} y2={my} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my - 4} x2={mx + 1} y2={my + 4} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my - 4} x2={mx + 4} y2={my - 4} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my} x2={mx + 4} y2={my} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my + 4} x2={mx + 4} y2={my + 4} stroke={stroke} strokeWidth={1} />
          </g>
        </>
      );
    case 'count': {
      // Auto-width pill that scales to the digit count; centered on markX.
      const label = String(stub.leafCount);
      const charW = 5;
      const w = Math.max(12, label.length * charW + 6);
      return (
        <>
          {connector}
          <rect
            x={mx - w / 2}
            y={my - 5}
            width={w}
            height={10}
            rx={5}
            ry={5}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <text
            x={mx}
            y={my + 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fontWeight={600}
            fill={text}
            pointerEvents="none"
          >
            {label}
          </text>
        </>
      );
    }
    case 'broken': {
      // Solid stub that ends in a small jagged "break" (zigzag) — no
      // terminal glyph, conveys "branch continues but is interrupted".
      const x0 = stub.markX - 6;
      const x1 = stub.markX;
      return (
        <>
          {/* L-bend, drawn solid up to the break start. */}
          <path
            d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${x0} ${stub.stubY}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          {/* Zigzag spans (x0..x1) at stubY. */}
          <polyline
            points={`${x0},${stub.stubY} ${x0 + 1.5},${stub.stubY - 3} ${x0 + 3},${stub.stubY + 3} ${x0 + 4.5},${stub.stubY - 3} ${x1},${stub.stubY + 1}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </>
      );
    }
    case 'bracket':
      // Solid L-bend ending in a small right bracket "]".
      return (
        <>
          {connector}
          <polyline
            points={`${mx - 1},${my - 4} ${mx + 3},${my - 4} ${mx + 3},${my + 4} ${mx - 1},${my + 4}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.2}
            pointerEvents="none"
          />
        </>
      );
  }
}

export const treeZone: ZoneDefinition<TreeZoneState> = {
  id: 'tree',
  displayName: 'Tree',
  Header: TreeHeader,
  Body: TreeBody,
  defaultWidth: 30,
  minWidth: 120,
  defaultZoneState: { prunedNodeStyle: DEFAULT_PRUNED_STYLE },
  isAvailable: (data) => Boolean(data.tree),
};
