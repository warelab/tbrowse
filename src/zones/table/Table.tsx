import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeId, Tree, ZoneDefinition, ZoneRenderProps } from '../../types';
import { buildChildrenIndex, type ChildrenIndex } from '../../treeIndex';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';
import { useTBrowseStore } from '../../store';
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
  buildHeatmapDomains,
  heatmapBackground,
  heatmapForeground,
  normalize,
  type HeatmapDomain,
} from './heatmap';
import { ConfigPopover } from './ConfigPopover';
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
    effective.push({
      id,
      base,
      label: ov.label ?? base.label,
      kind,
      width: base.width ?? DEFAULT_COL_WIDTH,
      align: base.align ?? defaultAlign(kind),
      display,
      aggregator,
      format: base.format,
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
  // colours stay stable as the user collapses / prunes / scrolls. We
  // only build domains for numerical columns; the body skips heatmap
  // colouring when no domain is registered.
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
    const name = state.name ?? opts.defaultName;
    const { effective, orderedIds } = useMemo(
      () => resolveColumns(factoryColumns, state),
      [state],
    );
    const { offsets, contentWidth } = useMemo(
      () => computeOffsets(effective),
      [effective],
    );

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (!editing) setDraft(name);
    }, [editing, name]);

    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [editing]);

    const commit = () => {
      const trimmed = draft.trim();
      const next = trimmed === '' ? undefined : trimmed;
      setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), name: next }));
      setEditing(false);
    };
    const cancel = () => {
      setDraft(name);
      setEditing(false);
    };

    const visibleColRange = visibleColumnsRange(width, bodyScrollLeft);

    return (
      <div
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
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                else if (e.key === 'Escape') cancel();
              }}
              style={{
                fontWeight: 600,
                fontSize: 13,
                background: 'var(--tbrowse-bg-input)',
                color: 'var(--tbrowse-text)',
                border: '1px solid var(--tbrowse-border)',
                borderRadius: 3,
                padding: '1px 4px',
                minWidth: 60,
                maxWidth: 160,
              }}
            />
          ) : (
            <span
              onClick={() => setEditing(true)}
              title="Click to rename"
              style={{
                fontWeight: 600,
                cursor: 'text',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 160,
              }}
            >
              {name}
            </span>
          )}
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
                  }}
                >
                  {c.label}
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
      () => resolveColumns(factoryColumns, state),
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
                  // Heatmap colouring on top of the row's hover/select bg —
                  // applied as a div background so hover/select stripes
                  // still tint the row in non-heatmap columns.
                  let cellBg: string | undefined;
                  let cellFg: string | undefined;
                  if (
                    c.display === 'heatmap' &&
                    heatmapValue !== null &&
                    heatmapDomains[c.id]
                  ) {
                    const t = normalize(heatmapValue, heatmapDomains[c.id]);
                    if (t !== null) {
                      cellBg = heatmapBackground(t, theme);
                      cellFg = heatmapForeground(t, theme);
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
    isAvailable: () => true,
    defaultVisible: opts.defaultVisible,
  };
}

// Re-exports kept for completeness of the public surface.
export { DEFAULT_METHOD_ID, methodForKind };
