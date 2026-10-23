import { useEffect, useMemo, useRef, useState } from 'react';
import {
  averageDosage,
  buildChildrenIndex,
  colorForAverageDosage,
  colorForCall,
  decodeCall,
  DEFAULT_SEP_PHASED,
  DEFAULT_SEP_UNPHASED,
  DEFAULT_UNKNOWN,
  rowsInRange,
  rowsTotalHeight,
  subtreeIdsOf,
  type DecodedCall,
  type GeneId,
  type GenotypeMatrix,
  type NodeId,
  type VariantSite,
} from 'tbrowse-core';
import type { ZoneDefinition, ZoneRenderProps } from '../../types';
import { useTBrowseStore } from '../../store';
import { EditableZoneName } from '../EditableZoneName';
import { rowsWithFlags } from '../rows';

const PAD_X = 4;
const ROW_VPAD = 2;
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
const BUTTON_ZOOM_FACTOR = 1.5;
/** Cell-width thresholds (as multiples of the glyph font size) at which
 *  the body starts rendering the actual allele letters (AA / AT / TT, …)
 *  on top of the heatmap fill. Two monospace characters are ~1.2 em; the
 *  ratio leaves a sliver of breathing room. Phased separators between
 *  the alleles need a third character, hence the wider ratio. At the
 *  default 11 px glyph these resolve to 16 px and 24 px. */
const GENOTYPE_TEXT_MIN_EM = 1.45;
const PHASED_TEXT_MIN_EM = 2.2;
/** Fallback phased-text threshold for callers without a font size. */
const PHASED_TEXT_MIN_PX = 24;

/** Single-letter allele abbreviation for an allele index. -1 ⇒ missing.
 *  Multi-character REF/ALT strings (indels, MNPs) get abbreviated to
 *  their first base so the cell still fits — the full string is in the
 *  click-tooltip. */
export function alleleChar(idx: number, variant: VariantSite | undefined): string {
  if (idx < 0) return '.';
  if (idx === 0) {
    const r = variant?.ref;
    return r && r.length > 0 ? r[0] : '?';
  }
  const alts = variant?.alt;
  if (!alts || idx - 1 >= alts.length) return '?';
  const a = alts[idx - 1];
  return a && a.length > 0 ? a[0] : '?';
}

/** Full allele string for an index — same lookup as `alleleChar` but
 *  preserves indel / MNP bases for hover and tooltip surfaces, where
 *  there's room to display the whole sequence. */
export function fullAllele(idx: number, variant: VariantSite | undefined): string {
  if (idx < 0) return '.';
  if (idx === 0) return variant?.ref ?? '?';
  const alts = variant?.alt;
  if (!alts || idx - 1 >= alts.length) return '?';
  return alts[idx - 1] ?? '?';
}

/** True when the variant has at least one multi-character REF/ALT —
 *  i.e. abbreviating to a single base would be lossy. */
export function isIndel(variant: VariantSite | undefined): boolean {
  if (!variant) return false;
  if (variant.ref && variant.ref.length > 1) return true;
  if (variant.alt && variant.alt.some((a) => a.length > 1)) return true;
  return false;
}

/** Render a decoded call as full allele letters (e.g. `"GTTTC/G"`) when
 *  REF/ALT are available. Falls back to the raw call string otherwise. */
export function callToAlleles(
  call: DecodedCall,
  variant: VariantSite | undefined,
  rawCall: string,
): string {
  if (!variant?.ref && (!variant?.alt || variant.alt.length === 0)) return rawCall;
  if (call.alleles.length === 0) return rawCall;
  const sep = call.phased ? '|' : '/';
  return call.alleles.map((a) => fullAllele(a, variant)).join(sep);
}

/** Genotype label for a cell. Returns null when the variant has no
 *  REF/ALT metadata (so the host hasn't supplied enough to label) or
 *  the call is fully missing — both cases keep the heatmap fill but
 *  skip the text overlay. `phasedMinPx` is the cell width needed to fit
 *  the phase separator between the two letters. */
export function genotypeText(
  call: DecodedCall,
  variant: VariantSite | undefined,
  showPhasing: boolean,
  cellW: number,
  phasedMinPx: number = PHASED_TEXT_MIN_PX,
): string | null {
  if (!variant?.ref && !variant?.alt) return null;
  if (call.alleles.length === 0) return null;
  if (call.missing && call.alleles.every((a) => a < 0)) return '.';
  const chars = call.alleles.map((a) => alleleChar(a, variant));
  if (showPhasing && call.phased && cellW >= phasedMinPx) {
    return chars.join('|');
  }
  return chars.join('');
}

/** `<reference>:<position>` when the site carries coordinates, else its id. */
export function variantLabel(v: VariantSite): string {
  if (v.position === undefined) return v.id;
  return `${v.reference ?? ''}${v.reference ? ':' : ''}${v.position.toLocaleString()}`;
}

/** Pick a legible text colour for the heatmap fill colour beneath. */
export function textColorForCall(call: DecodedCall): string {
  if (call.altDosage >= 2) return '#ffffff';
  return '#1a2733';
}

export interface GenotypeMatrixZoneState {
  /** User-set zone name override. */
  name?: string;
  /** Multiplier on the auto-fit cell width. 1 = fits the drawing area. */
  zoom: number;
  /** Horizontal pan in pixels. Reset by the fit button. */
  panPx: number;
  /** When true, phased calls draw a small notch between alleles. */
  showPhasing: boolean;
}

const DEFAULT_STATE: GenotypeMatrixZoneState = {
  zoom: 1,
  panPx: 0,
  showPhasing: false,
};

export interface CreateGenotypeMatrixZoneOptions {
  id: string;
  displayName?: string;
  matrix: GenotypeMatrix;
  defaultWidth?: number;
  minWidth?: number;
  defaultVisible?: boolean;
  initial?: Partial<GenotypeMatrixZoneState>;
}

/** Window-level event the body fires so the header's readout can track
 *  the variant column under the pointer. Scoped by zone id. */
const HOVER_VARIANT_EVENT = 'tbrowse:gtmatrix-hover-variant';

export function createGenotypeMatrixZone(
  opts: CreateGenotypeMatrixZoneOptions,
): ZoneDefinition<GenotypeMatrixZoneState> {
  const displayName = opts.displayName ?? 'Genotypes';
  const defaultWidth = opts.defaultWidth ?? 30;
  const minWidth = opts.minWidth ?? 200;
  const initialState: GenotypeMatrixZoneState = { ...DEFAULT_STATE, ...opts.initial };
  const matrix = opts.matrix;
  const sepPhased = matrix.sepPhased ?? DEFAULT_SEP_PHASED;
  const sepUnphased = matrix.sepUnphased ?? DEFAULT_SEP_UNPHASED;
  const unknown = matrix.unknownString ?? DEFAULT_UNKNOWN;
  const variantCount = matrix.variants.length;

  const Header = (props: ZoneRenderProps<GenotypeMatrixZoneState>) => {
    const { zoneState, setZoneState, hoveredNodeId, data } = props;
    const state = zoneState ?? initialState;
    // Mirror the body's coord math so the header pointer marker tracks the
    // currently-hovered cell. The body publishes its hover variant via a
    // window-level CustomEvent (see Body) — header just reads the latest
    // value out of state.
    const [hoverVariantIdx, setHoverVariantIdx] = useState<number | null>(null);
    useEffect(() => {
      const onHov = (e: Event) => {
        const ce = e as CustomEvent<{ id: string; idx: number | null }>;
        if (ce.detail.id !== opts.id) return;
        setHoverVariantIdx(ce.detail.idx);
      };
      window.addEventListener(HOVER_VARIANT_EVENT, onHov as EventListener);
      return () => window.removeEventListener(HOVER_VARIANT_EVENT, onHov as EventListener);
    }, []);

    const summary = `${variantCount} variants${matrix.regionLabel ? ` · ${matrix.regionLabel}` : ''}`;
    const hoveredCallInfo = (() => {
      if (!hoveredNodeId) return null;
      const node = data.tree.nodes[hoveredNodeId];
      const geneId = node?.geneId;
      if (!geneId) return null;
      const row = matrix.callsByGeneId[geneId];
      if (!row) return null;
      if (hoverVariantIdx === null || hoverVariantIdx < 0 || hoverVariantIdx >= variantCount) {
        return `${geneId} · ${row.length} variants`;
      }
      const v = matrix.variants[hoverVariantIdx];
      const rawCell = row[hoverVariantIdx] ?? unknown;
      // For indels (multi-character REF or ALT) the on-canvas cell is
      // abbreviated to first-base letters, so the hover line surfaces
      // the full allele strings — both the resolved call (e.g.
      // `GTTTC/G`) and a REF→ALT summary so the user can read the
      // variant without opening the click tooltip.
      const call = decodeCall(rawCell, sepPhased, sepUnphased, unknown);
      const alleles = callToAlleles(call, v, rawCell);
      const parts: string[] = [geneId, variantLabel(v), alleles];
      if (isIndel(v)) {
        const alts = v.alt && v.alt.length > 0 ? v.alt.join(',') : '?';
        parts.push(`REF=${v.ref ?? '?'} ALT=${alts}`);
      }
      return parts.join(' · ');
    })();

    const btnStyle = (active: boolean): React.CSSProperties => ({
      fontSize: 11,
      padding: '1px 6px',
      border: `1px solid ${active ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
      background: active ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
      color: active ? 'var(--tbrowse-accent-strong)' : 'var(--tbrowse-text)',
      borderRadius: 3,
      cursor: 'pointer',
    });
    const segGroupStyle: React.CSSProperties = {
      display: 'inline-flex',
      border: '1px solid var(--tbrowse-border)',
      borderRadius: 3,
      overflow: 'hidden',
    };
    const segBtnStyle = (position: 'first' | 'last'): React.CSSProperties => ({
      fontSize: 11,
      padding: '1px 6px',
      border: 'none',
      borderRight: position === 'first' ? '1px solid var(--tbrowse-border)' : 'none',
      background: 'var(--tbrowse-bg-input)',
      color: 'var(--tbrowse-text)',
      cursor: 'pointer',
      fontFamily: 'inherit',
    });
    const isFit = (state.panPx ?? 0) === 0 && (state.zoom ?? 1) === 1;

    return (
      <div
        data-genotype-matrix-zone-header={opts.id}
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
            gap: 6,
            padding: '0 10px 0 14px',
            flexWrap: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <EditableZoneName
            defaultName={displayName}
            customName={state.name}
            onChange={(next) =>
              setZoneState((s) => ({ ...(s ?? initialState), name: next }))
            }
          />
          <button
            type="button"
            onClick={() =>
              setZoneState((s) => ({
                ...(s ?? initialState),
                showPhasing: !(s ?? initialState).showPhasing,
              }))
            }
            style={btnStyle(state.showPhasing)}
            title={
              state.showPhasing
                ? 'Phasing notches shown — click to hide'
                : 'Phasing notches hidden — click to show'
            }
          >
            {sepPhased}
          </button>
          <div style={segGroupStyle} role="group" aria-label="Zoom">
            <button
              type="button"
              onClick={() =>
                setZoneState((s) => {
                  const cur = s ?? initialState;
                  const oldZoom = cur.zoom ?? 1;
                  const newZoom = Math.max(MIN_ZOOM, oldZoom / BUTTON_ZOOM_FACTOR);
                  if (newZoom === oldZoom) return cur;
                  const oldPan = cur.panPx ?? 0;
                  return { ...cur, zoom: newZoom, panPx: oldPan * (newZoom / oldZoom) };
                })
              }
              disabled={(state.zoom ?? 1) <= MIN_ZOOM + 1e-6}
              style={segBtnStyle('first')}
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() =>
                setZoneState((s) => {
                  const cur = s ?? initialState;
                  const oldZoom = cur.zoom ?? 1;
                  const newZoom = Math.min(MAX_ZOOM, oldZoom * BUTTON_ZOOM_FACTOR);
                  if (newZoom === oldZoom) return cur;
                  const oldPan = cur.panPx ?? 0;
                  return { ...cur, zoom: newZoom, panPx: oldPan * (newZoom / oldZoom) };
                })
              }
              disabled={(state.zoom ?? 1) >= MAX_ZOOM - 1e-6}
              style={segBtnStyle('last')}
              title="Zoom in"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              setZoneState((s) => ({
                ...(s ?? initialState),
                panPx: 0,
                zoom: 1,
              }))
            }
            disabled={isFit}
            style={{ ...btnStyle(!isFit), opacity: isFit ? 0.5 : 1 }}
            title="Reset pan and zoom"
          >
            {(state.zoom ?? 1) !== 1
              ? `${(state.zoom ?? 1).toFixed(2).replace(/\.?0+$/, '')}×`
              : 'fit'}
          </button>
        </div>
        <div
          style={{
            flex: '0 0 18px',
            minHeight: 0,
            padding: '0 10px 0 14px',
            display: 'flex',
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--tbrowse-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={hoveredCallInfo ?? ''}
        >
          {hoveredCallInfo ?? (
            <span style={{ color: 'var(--tbrowse-text-subtle)' }}>{summary}</span>
          )}
        </div>
      </div>
    );
  };

  const Body = (props: ZoneRenderProps<GenotypeMatrixZoneState>) => {
    const {
      visibleRows,
      rowRange,
      width,
      data,
      hoveredNodeId,
      hoveredSubtreeIds,
      selectedNodeId,
      onHoverNode,
      zoneState,
      setZoneState,
      prunedNodeIds,
    } = props;
    const state = zoneState ?? initialState;
    // Glyph size follows the host's Display font-size control, like the
    // MSA's residue glyphs; the text thresholds scale with it.
    const fontSize = useTBrowseStore((s) => s.fontSize);
    const glyphPx = Math.max(8, Math.round(fontSize * 0.92));
    const textMinPx = glyphPx * GENOTYPE_TEXT_MIN_EM;
    const phasedMinPx = glyphPx * PHASED_TEXT_MIN_EM;

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const totalHeight = useMemo(() => rowsTotalHeight(visibleRows), [visibleRows]);

    const drawingWidth = Math.max(1, width - 2 * PAD_X);
    const baseCellW = variantCount > 0 ? drawingWidth / variantCount : 0;
    const cellW = baseCellW * state.zoom;

    // Pre-compute per-collapsed-summary leaf id sets, restricted to the
    // active (non-pruned) set. Mirrors the MSA approach so collapsed
    // clades show an averaged dosage row rather than going blank.
    const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);
    const leafIdsOf = useMemo(() => {
      const cache = new Map<NodeId, GeneId[]>();
      return (rootId: NodeId): GeneId[] => {
        const cached = cache.get(rootId);
        if (cached) return cached;
        const subtree = subtreeIdsOf(rootId, childrenIndex);
        const ids: GeneId[] = [];
        for (const id of subtree) {
          if (prunedNodeIds.has(id)) continue;
          const node = data.tree.nodes[id];
          if (node?.isLeaf && node.geneId && matrix.callsByGeneId[node.geneId]) {
            ids.push(node.geneId);
          }
        }
        cache.set(rootId, ids);
        return ids;
      };
    }, [data.tree, childrenIndex, prunedNodeIds]);

    // Canvas paint. Repaints whenever any input that affects the picture
    // changes — viewport scroll inside the chassis re-feeds visibleRows /
    // rowRange so we pick those up automatically.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || variantCount === 0 || width <= 0 || totalHeight <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(totalHeight * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${totalHeight}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, totalHeight);

      const rows = rowsInRange(visibleRows, rowRange);
      const xOffset = PAD_X - state.panPx;
      // Render the actual genotype letters (AA / AT / TT) once a cell is
      // wide enough to fit them. The threshold pairs with the font size
      // so we never draw clipped text — anything tighter falls back to
      // colour-only.
      const showText = cellW >= textMinPx;
      if (showText) {
        ctx.font = `${glyphPx}px ui-monospace, "SF Mono", Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      }
      // First visible variant (clamped) so we don't waste calls on cells
      // entirely outside the drawing area.
      const firstCol = cellW > 0 ? Math.max(0, Math.floor(-xOffset / cellW)) : 0;
      const lastCol =
        cellW > 0
          ? Math.min(variantCount - 1, Math.ceil((width - xOffset) / cellW))
          : variantCount - 1;

      for (const r of rows) {
        const rowH = r.height - ROW_VPAD * 2;
        const rowY = r.y + ROW_VPAD;
        if (r.kind === 'leaf') {
          const node = data.tree.nodes[r.nodeId];
          const geneId = node?.geneId;
          const calls = geneId ? matrix.callsByGeneId[geneId] : undefined;
          if (!calls) {
            ctx.fillStyle = 'rgba(0,0,0,0.025)';
            ctx.fillRect(0, r.y, width, r.height);
            continue;
          }
          ctx.globalAlpha = r.opacity ?? 1;
          for (let i = firstCol; i <= lastCol; i++) {
            const x = xOffset + i * cellW;
            const w = Math.max(1, cellW + 1); // +1 avoids 1px seams at non-integer scale
            const call = decodeCall(calls[i], sepPhased, sepUnphased, unknown);
            ctx.fillStyle = colorForCall(call);
            ctx.fillRect(Math.floor(x), rowY, Math.ceil(w), rowH);
            if (showText) {
              const text = genotypeText(
                call,
                matrix.variants[i],
                state.showPhasing,
                cellW,
                phasedMinPx,
              );
              if (text) {
                ctx.fillStyle = textColorForCall(call);
                ctx.fillText(text, Math.floor(x) + cellW / 2, rowY + rowH / 2);
              }
            }
            if (state.showPhasing && call.phased && cellW > 4 && !call.missing) {
              ctx.fillStyle = 'rgba(0,0,0,0.4)';
              ctx.fillRect(Math.floor(x + cellW / 2 - 0.5), rowY, 1, rowH);
            }
          }
          ctx.globalAlpha = 1;
        } else {
          // Collapsed-summary row: render an averaged-dosage track. Same
          // pixel layout as a leaf row so columns line up vertically.
          const ids = leafIdsOf(r.nodeId);
          if (ids.length === 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.025)';
            ctx.fillRect(0, r.y, width, r.height);
            continue;
          }
          ctx.globalAlpha = (r.opacity ?? 1) * 0.85;
          for (let i = firstCol; i <= lastCol; i++) {
            const x = xOffset + i * cellW;
            const w = Math.max(1, cellW + 1);
            const avg = averageDosage(matrix, ids, i, sepPhased, sepUnphased, unknown);
            ctx.fillStyle = avg === null ? '#ececec' : colorForAverageDosage(avg);
            ctx.fillRect(Math.floor(x), rowY, Math.ceil(w), rowH);
          }
          ctx.globalAlpha = 1;
        }
      }
    }, [
      visibleRows,
      rowRange,
      width,
      totalHeight,
      cellW,
      glyphPx,
      textMinPx,
      phasedMinPx,
      state.panPx,
      state.showPhasing,
      data.tree,
      leafIdsOf,
    ]);

    // Mouse-coord → (row, variantIdx) helper.
    const localCoords = (
      e: React.MouseEvent | MouseEvent,
    ): { row: (typeof visibleRows)[number] | null; variantIdx: number | null } => {
      const el = containerRef.current;
      if (!el) return { row: null, variantIdx: null };
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let row: (typeof visibleRows)[number] | null = null;
      for (const r of rowsInRange(visibleRows, rowRange)) {
        if (y >= r.y && y < r.y + r.height) {
          row = r;
          break;
        }
      }
      let variantIdx: number | null = null;
      if (cellW > 0) {
        const idx = Math.floor((x + state.panPx - PAD_X) / cellW);
        if (idx >= 0 && idx < variantCount) variantIdx = idx;
      }
      return { row, variantIdx };
    };

    const publishHoverVariant = (idx: number | null) => {
      window.dispatchEvent(
        new CustomEvent(HOVER_VARIANT_EVENT, { detail: { id: opts.id, idx } }),
      );
    };
    const onMouseMove = (e: React.MouseEvent) => {
      const { row, variantIdx } = localCoords(e);
      onHoverNode(row?.nodeId ?? null);
      // Cross-component header hover marker. Cheap and scoped to this id.
      publishHoverVariant(variantIdx);
    };
    const onMouseLeave = () => {
      onHoverNode(null);
      publishHoverVariant(null);
    };

    // Click → tooltip with variant + call details.
    type Tip = {
      screenX: number;
      screenY: number;
      title: string;
      lines: string[];
    };
    const [tip, setTip] = useState<Tip | null>(null);
    useEffect(() => {
      if (!tip) return;
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') setTip(null);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [tip]);

    const onClick = (e: React.MouseEvent) => {
      if (dragRef.current?.engaged) return;
      const { row, variantIdx } = localCoords(e);
      if (!row || row.kind !== 'leaf' || variantIdx === null) return;
      const node = data.tree.nodes[row.nodeId];
      const geneId = node?.geneId;
      if (!geneId) return;
      const calls = matrix.callsByGeneId[geneId];
      if (!calls) return;
      const v: VariantSite = matrix.variants[variantIdx];
      const cell = calls[variantIdx] ?? unknown;
      const call = decodeCall(cell, sepPhased, sepUnphased, unknown);
      const lines: string[] = [];
      lines.push(`sample: ${geneId}`);
      lines.push(`variant: ${variantLabel(v)}`);
      lines.push(`call: ${cell}${call.phased ? ' (phased)' : ''}`);
      if (v.ref || (v.alt && v.alt.length > 0)) {
        const alts = v.alt && v.alt.length > 0 ? v.alt.join(',') : '?';
        lines.push(`alleles: ${v.ref ?? '?'} → ${alts}`);
      }
      if (v.alleleFrequency !== undefined) {
        lines.push(`AF: ${v.alleleFrequency.toFixed(3)}`);
      }
      lines.push(`alt dosage: ${call.altDosage}`);
      setTip({ screenX: e.clientX, screenY: e.clientY, title: v.id, lines });
    };

    // Drag-pan, threshold-gated so a brief click still reaches the click
    // handler.
    const DRAG_THRESHOLD = 4;
    const dragRef = useRef<{ startX: number; startPan: number; engaged: boolean } | null>(
      null,
    );
    const onMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startPan: state.panPx ?? 0, engaged: false };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        if (!dragRef.current.engaged) {
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          dragRef.current.engaged = true;
        }
        setZoneState((s) => ({
          ...(s ?? initialState),
          panPx: dragRef.current!.startPan - dx,
        }));
      };
      const onUp = () => {
        // Engagement flag is read by `onClick` synchronously after mouseup,
        // so we keep the ref alive through the same tick and clear it on
        // a microtask.
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        queueMicrotask(() => {
          dragRef.current = null;
        });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    // Trackpad pinch-zoom — same convention as the genome zone (wheel
    // event with ctrlKey/metaKey from the OS).
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const handler = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const factor = Math.exp(-e.deltaY * 0.01);
        setZoneState((s) => {
          const cur = s ?? initialState;
          const oldZoom = cur.zoom ?? 1;
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
          if (newZoom === oldZoom) return cur;
          // Anchor zoom at the cursor — keep the column under the pointer
          // fixed by adjusting pan after the scale change.
          const oldPan = cur.panPx ?? 0;
          const cursorOffset = cursorX - PAD_X;
          const dataX = cursorOffset + oldPan;
          const newPan = (dataX * newZoom) / oldZoom - cursorOffset;
          return { ...cur, zoom: newZoom, panPx: newPan };
        });
      };
      el.addEventListener('wheel', handler, { passive: false });
      return () => el.removeEventListener('wheel', handler);
    }, [setZoneState]);

    // Row hover/select highlight as a thin SVG overlay above the canvas.
    const flaggedRows = rowsWithFlags(visibleRows, rowRange, {
      hoveredNodeId,
      hoveredSubtreeIds,
      selectedNodeId,
    });

    return (
      <>
        <div
          ref={containerRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onClick={onClick}
          style={{
            position: 'relative',
            width,
            height: totalHeight,
            overflow: 'hidden',
            cursor: dragRef.current?.engaged ? 'grabbing' : 'crosshair',
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', inset: 0 }} />
          <svg
            width={width}
            height={totalHeight}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {flaggedRows.map(({ row, background }) => {
              if (background === 'transparent') return null;
              return (
                <rect
                  key={`tint-${row.nodeId}`}
                  x={0}
                  y={row.y}
                  width={width}
                  height={row.height}
                  fill={background}
                  opacity={0.4}
                />
              );
            })}
          </svg>
        </div>
        {tip && <GenotypeTooltip tip={tip} onClose={() => setTip(null)} />}
      </>
    );
  };

  return {
    id: opts.id,
    displayName,
    Header,
    Body,
    defaultWidth,
    minWidth,
    defaultZoneState: initialState,
    // The matrix is bound at construction (it's not a HostData field), so
    // availability is a property of the matrix rather than of `data`.
    isAvailable: () => variantCount > 0 && Object.keys(matrix.callsByGeneId).length > 0,
    defaultVisible: opts.defaultVisible,
    // One of the per-leaf detail tracks (msa / neighborhood / genome /
    // genotypes) — only one shows at a time unless the user unlinks them.
    exclusiveGroup: 'detail',
  };
}

function GenotypeTooltip({
  tip,
  onClose,
}: {
  tip: { screenX: number; screenY: number; title: string; lines: string[] };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);
  const margin = 8;
  const estW = 280;
  const estH = 140;
  const left = Math.min(tip.screenX + 12, window.innerWidth - estW - margin);
  const top = Math.min(tip.screenY + 12, window.innerHeight - estH - margin);
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 2000,
        background: 'var(--tbrowse-bg-elevated)',
        border: '1px solid var(--tbrowse-border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px var(--tbrowse-tooltip-shadow)',
        padding: '8px 10px',
        fontSize: 12,
        color: 'var(--tbrowse-text)',
        maxWidth: 320,
        minWidth: 200,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>{tip.title}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--tbrowse-text-muted)',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      {tip.lines.map((line, i) => (
        <div
          key={i}
          style={{
            color: 'var(--tbrowse-text-muted)',
            fontSize: 11,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
