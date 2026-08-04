import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId, Tree, ZoneDefinition, ZoneRenderProps } from '../../types';
import { buildChildrenIndex, type ChildrenIndex } from '../../treeIndex';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';
import { useTBrowseStore } from '../../store';
import { EditableZoneName } from '../EditableZoneName';
import {
  AGGREGATE_METHODS,
  DEFAULT_METHOD_ID,
  defaultAggregators,
  methodForKind,
  normalizeAggregateResult,
  NULL_GLYPH,
  type AggregateContext,
  type AggregateFn,
  type AggregateResult,
  type ColumnKind,
} from './aggregators';
import {
  autoPalette,
  buildHeatmapDomains,
  colorAt,
  paletteById,
  rgbCss,
  readableForeground,
  type HeatmapDomain,
  type Palette,
} from './heatmap';
import { ConfigPopover } from './ConfigPopover';
import { compileStringMatcher, type SearchField } from '../../search/fields';
import type {
  CreateTableZoneOptions,
  TableCellValue,
  TableColumn,
  TableData,
  TableDisplayMode,
  TableZoneState,
} from './types';

export type {
  AggregateContext,
  AggregateFn,
  AggregateResult,
  ColumnKind,
  CreateTableZoneOptions,
  TableCellValue,
  TableColumn,
  TableData,
  TableDisplayMode,
  TableZoneState,
};
export { AGGREGATE_METHODS, defaultAggregators };
export type { TableColumnOverride } from './types';

const DEFAULT_COL_WIDTH = 90;
const MIN_COL_WIDTH = 30;
const HEADER_ROW_HEIGHT = LEAF_ROW_HEIGHT;

const DEFAULT_STATE: TableZoneState = {};

interface EffectiveColumn {
  id: string;
  base: TableColumn;
  label: string;
  kind: ColumnKind;
  width: number;
  align: 'left' | 'right' | 'center';
  display: TableDisplayMode;
  aggregator: AggregateFn;
  format?: (value: TableCellValue) => string;
  /** Resolved palette for heatmap rendering. Always populated for
   *  number-kind columns; ignored when `display !== 'heatmap'`. */
  palette: Palette;
  /** Anchor for the diverging-palette midpoint, in data units. */
  paletteMidpoint: number;
}

function defaultFormat(value: TableCellValue, kind: ColumnKind): string {
  if (value === null || value === undefined) return NULL_GLYPH;
  if (kind === 'boolean') return value ? '✓' : '';
  if (kind === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString();
    }
    return String(value);
  }
  return String(value);
}

function defaultAlign(kind: ColumnKind): 'left' | 'right' | 'center' {
  if (kind === 'number') return 'right';
  if (kind === 'boolean') return 'center';
  return 'left';
}

function justifyFor(align: 'left' | 'right' | 'center'): React.CSSProperties['justifyContent'] {
  if (align === 'right') return 'flex-end';
  if (align === 'center') return 'center';
  return 'flex-start';
}

function visibleColumnsRange(width: number, scrollLeft: number) {
  return { start: scrollLeft, end: scrollLeft + width };
}

/** Resolve the user's overrides on top of the factory column definitions
 *  to produce the list rendered by the body. Hidden columns are filtered
 *  out; the order honours `state.columnOrder` with any missing ids
 *  appended in factory order. Per-column display/kind/aggregation
 *  decisions also fall through to factory ⇒ kind defaults. */
function resolveColumns(
  factory: TableColumn[],
  state: TableZoneState | undefined,
  heatmapDomains: Record<string, HeatmapDomain>,
): { effective: EffectiveColumn[]; orderedIds: string[] } {
  const overrides = state?.columnOverrides ?? {};
  const factoryIds = factory.map((c) => c.id);
  const order = state?.columnOrder;
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  if (order) {
    for (const id of order) {
      if (factoryIds.includes(id) && !seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  }
  for (const id of factoryIds) {
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  const factoryById = new Map(factory.map((c) => [c.id, c]));
  const effective: EffectiveColumn[] = [];
  for (const id of orderedIds) {
    const base = factoryById.get(id);
    if (!base) continue;
    const ov = overrides[id] ?? {};
    if (ov.hidden) continue;
    const kind: ColumnKind = ov.kind ?? base.kind ?? 'string';
    const factoryDisplay = base.display ?? 'text';
    let display = ov.display ?? factoryDisplay;
    // Heatmap is numeric-only; coerce silently if a kind change made it
    // illegal (the popover prevents this UX-side, but URL-state import
    // can still produce mismatches).
    if (display === 'heatmap' && kind !== 'number') display = 'text';
    let aggregator: AggregateFn;
    if (base.aggregate) aggregator = base.aggregate;
    else aggregator = methodForKind(kind, ov.aggregateMethod).fn;
    // Palette resolution: explicit override → factory default → auto
    // (sequential vs diverging based on whether the data crosses 0).
    const explicit = ov.palette ?? base.palette;
    const domain = heatmapDomains[id];
    const palette = explicit
      ? paletteById(explicit)
      : domain
        ? autoPalette(domain)
        : paletteById(undefined);
    const paletteMidpoint = ov.paletteMidpoint ?? base.paletteMidpoint ?? 0;
    effective.push({
      id,
      base,
      label: ov.label ?? base.label,
      kind,
      width: Math.max(MIN_COL_WIDTH, ov.width ?? base.width ?? DEFAULT_COL_WIDTH),
      align: base.align ?? defaultAlign(kind),
      display,
      aggregator,
      format: base.format,
      palette,
      paletteMidpoint,
    });
  }
  return { effective, orderedIds };
}

function computeOffsets(cols: EffectiveColumn[]): {
  offsets: number[];
  contentWidth: number;
} {
  const offsets: number[] = [];
  let acc = 0;
  for (const c of cols) {
    offsets.push(acc);
    acc += c.width;
  }
  return { offsets, contentWidth: acc };
}

/** Collect non-null table values for one column across every leaf under
 *  the collapsed subtree rooted at `nodeId`. Pruned subtrees are skipped
 *  so totals match the chassis-supplied `leafCount` for the row. */
function collectColumnValues(
  rootId: NodeId,
  columnId: string,
  table: TableData,
  tree: Tree,
  childrenIndex: ChildrenIndex,
  prunedNodeIds: ReadonlySet<NodeId>,
): AggregateContext {
  const values: TableCellValue[] = [];
  let totalLeaves = 0;
  let leavesWithValue = 0;
  const stack: NodeId[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (prunedNodeIds.has(id)) continue;
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.isLeaf) {
      totalLeaves++;
      if (n.geneId) {
        const row = table[n.geneId];
        if (row && columnId in row) {
          const v = row[columnId];
          if (v !== null && v !== undefined) {
            values.push(v);
            leavesWithValue++;
          }
        }
      }
      continue;
    }
    const kids = childrenIndex.get(id);
    if (kids) for (const k of kids) stack.push(k);
  }
  return { values, totalLeaves, leavesWithValue };
}

export function createTableZone(
  opts: CreateTableZoneOptions,
): ZoneDefinition<TableZoneState> {
  const factoryColumns = opts.columns;
  // Per-column heatmap domains are computed once across the full table —
  // colors stay stable as the user collapses / prunes / scrolls. We
  // only build domains for numerical columns; the body skips heatmap
  // coloring when no domain is registered.
  const heatmapDomains: Record<string, HeatmapDomain> = buildHeatmapDomains(
    opts.table,
    factoryColumns.filter((c) => (c.kind ?? 'string') === 'number').map((c) => c.id),
  );
  const fallbackContentWidth = factoryColumns.reduce(
    (n, c) => n + (c.width ?? DEFAULT_COL_WIDTH),
    0,
  );

  const Header = (props: ZoneRenderProps<TableZoneState>) => {
    const { zoneState, setZoneState, width, bodyScrollLeft } = props;
    const state = zoneState ?? DEFAULT_STATE;
    const { effective, orderedIds } = useMemo(
      () => resolveColumns(factoryColumns, state, heatmapDomains),
      [state],
    );
    const { offsets, contentWidth } = useMemo(
      () => computeOffsets(effective),
      [effective],
    );

    const visibleColRange = visibleColumnsRange(width, bodyScrollLeft);

    return (
      <div
        data-table-zone-header={opts.id}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
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
            padding: '0 10px 0 14px',
          }}
        >
          <EditableZoneName
            defaultName={opts.defaultName}
            customName={state.name}
            onChange={(next) =>
              setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), name: next }))
            }
          />
          <span
            style={{
              color: 'var(--tbrowse-text-subtle)',
              fontSize: 11,
              fontWeight: 400,
            }}
          >
            {effective.length}/{factoryColumns.length} col
            {factoryColumns.length === 1 ? '' : 's'}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <ConfigPopover
              factoryColumns={factoryColumns}
              state={state}
              setState={(next) =>
                setZoneState((s) =>
                  typeof next === 'function' ? next(s ?? DEFAULT_STATE) : next,
                )
              }
              orderedIds={orderedIds}
              heatmapDomains={heatmapDomains}
            />
          </span>
        </div>
        <div
          style={{
            flex: `0 0 ${HEADER_ROW_HEIGHT}px`,
            minHeight: 0,
            position: 'relative',
            overflow: 'hidden',
            borderTop: '1px solid var(--tbrowse-border-soft)',
            background: 'var(--tbrowse-bg-alt)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: contentWidth,
              transform: `translateX(${-bodyScrollLeft}px)`,
              display: 'flex',
            }}
          >
            {effective.map((c, i) => {
              if (
                offsets[i] + c.width < visibleColRange.start ||
                offsets[i] > visibleColRange.end
              ) {
                return (
                  <div
                    key={c.id}
                    style={{ width: c.width, flex: `0 0 ${c.width}px` }}
                  />
                );
              }
              return (
                <div
                  key={c.id}
                  title={c.label}
                  style={{
                    width: c.width,
                    flex: `0 0 ${c.width}px`,
                    padding: '0 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: justifyFor(c.align),
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--tbrowse-text-muted)',
                    borderRight: '1px solid var(--tbrowse-border-soft)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.label}
                  </span>
                  <ResizeHandle
                    columnId={c.id}
                    currentWidth={c.width}
                    factoryWidth={c.base.width ?? DEFAULT_COL_WIDTH}
                    setZoneState={(updater) =>
                      setZoneState((s) => updater(s ?? DEFAULT_STATE))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const Body = (props: ZoneRenderProps<TableZoneState>) => {
    const {
      visibleRows,
      rowRange,
      hoveredNodeId,
      hoveredSubtreeIds,
      selectedNodeId,
      prunedNodeIds,
      onHoverNode,
      onSelectNode,
      width,
      bodyScrollLeft,
      setBodyScrollLeft,
      data,
      zoneState,
    } = props;
    const state = zoneState ?? DEFAULT_STATE;
    const theme = useTBrowseStore((s) => s.theme);

    const { effective } = useMemo(
      () => resolveColumns(factoryColumns, state, heatmapDomains),
      [state],
    );
    const { offsets, contentWidth } = useMemo(
      () => computeOffsets(effective),
      [effective],
    );

    const maxScroll = Math.max(0, contentWidth - width);

    useEffect(() => {
      if (bodyScrollLeft > maxScroll) setBodyScrollLeft(maxScroll);
    }, [bodyScrollLeft, maxScroll, setBodyScrollLeft]);

    const onWheel = useCallback(
      (e: React.WheelEvent) => {
        if (maxScroll <= 0) return;
        if (e.deltaX === 0) return;
        e.preventDefault();
        setBodyScrollLeft((prev) => Math.max(0, Math.min(maxScroll, prev + e.deltaX)));
      },
      [maxScroll, setBodyScrollLeft],
    );

    const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);
    const visibleColRange = visibleColumnsRange(width, bodyScrollLeft);
    const childrenIndex = useMemo(
      () => buildChildrenIndex(data.tree),
      [data.tree],
    );

    return (
      <div
        onWheel={onWheel}
        style={{ position: 'relative', height: '100%', overflow: 'hidden' }}
      >
        <div
          style={{
            position: 'relative',
            width: contentWidth,
            height: '100%',
            transform: `translateX(${-bodyScrollLeft}px)`,
          }}
        >
          {rows.map((r) => {
            const isExactHover = hoveredNodeId === r.nodeId;
            const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
            const isSelected = selectedNodeId === r.nodeId;
            const isCollapsed = r.kind === 'collapsedSummary';
            const node = data.tree.nodes[r.nodeId];
            const geneId = node?.geneId;
            const rowData =
              !isCollapsed && geneId ? opts.table[geneId] : undefined;

            return (
              <div
                key={r.nodeId}
                onMouseEnter={() => onHoverNode(r.nodeId)}
                onMouseLeave={() => onHoverNode(null)}
                onClick={() => {
                  const sel = window.getSelection();
                  if (sel && sel.toString().length > 0) return;
                  onSelectNode(r.nodeId);
                }}
                style={{
                  position: 'absolute',
                  top: r.y,
                  left: 0,
                  width: contentWidth,
                  height: r.height,
                  display: 'flex',
                  background: isSelected
                    ? 'var(--tbrowse-row-select-bg)'
                    : isExactHover
                      ? 'var(--tbrowse-row-hover-bg)'
                      : isInHoveredSubtree
                        ? 'var(--tbrowse-row-subtree-bg)'
                        : 'transparent',
                  borderBottom: '1px solid var(--tbrowse-border-row)',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: isCollapsed
                    ? 'var(--tbrowse-text-muted)'
                    : 'var(--tbrowse-text)',
                  fontStyle: isCollapsed ? 'italic' : 'normal',
                  fontWeight: isInHoveredSubtree ? 600 : 400,
                  opacity: r.opacity ?? 1,
                  transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
                  userSelect: 'text',
                }}
              >
                {effective.map((c, i) => {
                  if (
                    offsets[i] + c.width < visibleColRange.start ||
                    offsets[i] > visibleColRange.end
                  ) {
                    return (
                      <div
                        key={c.id}
                        style={{ width: c.width, flex: `0 0 ${c.width}px` }}
                      />
                    );
                  }
                  let cellText: string;
                  let cellTitle: string;
                  let isMissing: boolean;
                  let heatmapValue: number | null = null;
                  if (isCollapsed) {
                    const ctx = collectColumnValues(
                      r.nodeId,
                      c.id,
                      opts.table,
                      data.tree,
                      childrenIndex,
                      prunedNodeIds,
                    );
                    const out = normalizeAggregateResult(c.aggregator(ctx));
                    cellText = out.text;
                    cellTitle = out.title ?? out.text;
                    isMissing = ctx.leavesWithValue === 0;
                    if (
                      c.display === 'heatmap' &&
                      typeof out.numeric === 'number'
                    ) {
                      heatmapValue = out.numeric;
                    }
                  } else {
                    const raw = rowData?.[c.id];
                    isMissing = raw === null || raw === undefined;
                    cellText = c.format
                      ? c.format(raw)
                      : defaultFormat(raw, c.kind);
                    cellTitle = isMissing ? '' : cellText;
                    if (
                      c.display === 'heatmap' &&
                      typeof raw === 'number' &&
                      Number.isFinite(raw)
                    ) {
                      heatmapValue = raw;
                    }
                  }
                  // Heatmap coloring on top of the row's hover/select bg —
                  // applied as a div background so hover/select stripes
                  // still tint the row in non-heatmap columns.
                  let cellBg: string | undefined;
                  let cellFg: string | undefined;
                  if (
                    c.display === 'heatmap' &&
                    heatmapValue !== null &&
                    heatmapDomains[c.id]
                  ) {
                    const rgb = colorAt(
                      heatmapValue,
                      heatmapDomains[c.id],
                      c.palette,
                      theme,
                      c.paletteMidpoint,
                    );
                    if (rgb) {
                      cellBg = rgbCss(rgb);
                      cellFg = readableForeground(rgb, theme);
                    }
                  }
                  return (
                    <div
                      key={c.id}
                      title={cellTitle}
                      style={{
                        width: c.width,
                        flex: `0 0 ${c.width}px`,
                        padding: '0 6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: justifyFor(c.align),
                        borderRight: '1px solid var(--tbrowse-border-row)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: cellFg ?? (isMissing
                          ? 'var(--tbrowse-text-subtle)'
                          : 'inherit'),
                        background: cellBg,
                        fontVariantNumeric:
                          c.kind === 'number' ? 'tabular-nums' : undefined,
                      }}
                    >
                      {cellText}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return {
    id: opts.id,
    displayName: opts.defaultName,
    Header,
    Body,
    defaultWidth:
      opts.defaultWidth ?? Math.min(40, Math.max(10, fallbackContentWidth / 20)),
    minWidth: opts.minWidth ?? 80,
    defaultZoneState: DEFAULT_STATE,
    isAvailable: (data) => {
      // The zone keeps its rows keyed by GeneId at factory time; if the
      // currently-loaded tree has no leaves whose `geneId` appears in
      // the table, every row would render an empty cell. Treat the zone
      // as unavailable in that case so the chassis hides it (and the
      // toggle button greys out) until a tree with matching gene ids is
      // loaded. Cheap O(N_leaves) hash lookup — early-exits on the
      // first match.
      for (const node of Object.values(data.tree.nodes)) {
        if (node.isLeaf && node.geneId && opts.table[node.geneId]) {
          return true;
        }
      }
      return false;
    },
    defaultVisible: opts.defaultVisible,
    getSearchFields: (state, _data) => {
      const overrides = state?.columnOverrides ?? {};
      const zoneName = state?.name ?? opts.defaultName;
      const fields: SearchField[] = [];
      for (const col of factoryColumns) {
        const ov = overrides[col.id] ?? {};
        const kind = ov.kind ?? col.kind ?? 'string';
        if (kind !== 'string') continue;
        const enabled = ov.searchable ?? col.searchable ?? false;
        if (!enabled) continue;
        const label = `${zoneName} | ${ov.label ?? col.label}`;
        fields.push(buildTableColumnSearchField(opts.id, col.id, label, opts.table));
      }
      return fields;
    },
  };
}

/** Build a SearchField that scans cell values in `table[geneId]?.[columnId]`.
 *  String values only — non-string entries are coerced via `String(...)` so
 *  numbers stringified by the host (e.g. accession ids stored as numbers)
 *  still match, but the match-span pointer remains accurate. */
function buildTableColumnSearchField(
  zoneId: string,
  columnId: string,
  label: string,
  table: TableData,
): SearchField {
  const id = `table:${zoneId}:${columnId}`;
  const valueOf = (geneId: string | undefined): string | null => {
    if (!geneId) return null;
    const v = table[geneId]?.[columnId];
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : String(v);
  };
  return {
    id,
    label,
    buildPredicate(query, opts) {
      const matcher = compileStringMatcher(query, opts);
      if (!matcher.ok) return matcher;
      return {
        ok: true,
        test: (node) => {
          const v = valueOf(node.geneId);
          return v != null && matcher.test(v);
        },
      };
    },
    describeMatch(node, query, opts) {
      const v = valueOf(node.geneId);
      if (v == null) return null;
      const matcher = compileStringMatcher(query, opts);
      if (!matcher.ok) return null;
      const span = matcher.spanOf(v);
      return span ? { value: v, start: span[0], end: span[1] } : null;
    },
  };
}

/** A 6 px-wide hit target sitting on the column's right edge. Drag to
 *  resize the column; double-click to clear the user override and
 *  restore the factory width. The cursor is `col-resize` so the
 *  affordance reads even when the strip itself stays invisible. */
function ResizeHandle({
  columnId,
  currentWidth,
  factoryWidth,
  setZoneState,
}: {
  columnId: string;
  currentWidth: number;
  factoryWidth: number;
  setZoneState: (
    updater: (prev: TableZoneState) => TableZoneState,
  ) => void;
}) {
  const [hover, setHover] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const setOverrideWidth = (next: number | undefined) => {
    setZoneState((prev) => {
      const overrides = { ...(prev.columnOverrides ?? {}) };
      const cur = overrides[columnId] ?? {};
      const merged = { ...cur, width: next };
      if (next === undefined) delete merged.width;
      // Drop the entry entirely when nothing's overridden.
      if (Object.keys(merged).filter((k) => merged[k as keyof typeof merged] !== undefined).length === 0) {
        delete overrides[columnId];
      } else {
        overrides[columnId] = merged;
      }
      return { ...prev, columnOverrides: overrides };
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startWidth: currentWidth };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const next = Math.max(MIN_COL_WIDTH, dragRef.current.startWidth + dx);
      setOverrideWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Setting width undefined clears the override; the column reverts
    // to the factory width on next render.
    void factoryWidth;
    setOverrideWidth(undefined);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Drag to resize · double-click to reset"
      style={{
        position: 'absolute',
        top: 0,
        right: -3,
        width: 6,
        height: '100%',
        cursor: 'col-resize',
        zIndex: 1,
        background: hover ? 'var(--tbrowse-accent)' : 'transparent',
        opacity: hover ? 0.6 : 1,
        userSelect: 'none',
        touchAction: 'none',
      }}
    />
  );
}

// Re-exports kept for completeness of the public surface.
export { DEFAULT_METHOD_ID, methodForKind };
