import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MSA, ZoneDefinition, ZoneRenderProps } from '../../types';
import {
  applicableSchemes,
  defaultSchemeFor,
  getScheme,
  type ColorSchemeId,
} from './coloring';
import { Minimap } from './Minimap';

export interface MSAZoneState {
  /** First column (inclusive) of the visible viewport. */
  viewportStart: number;
  /** Last column (exclusive). When <= viewportStart, treat as "full alignment". */
  viewportEnd: number;
  /** Optional. Falls back to defaultSchemeFor(alphabet) when undefined. */
  colorSchemeId?: ColorSchemeId;
}

const DEFAULT_STATE: MSAZoneState = { viewportStart: 0, viewportEnd: 0 };

const PAD_X = 4;
const TEXT_RENDER_MIN_PX = 7;
const RESIDUE_COLOR = '#444';
const RESIDUE_BG_COLOR = '#cfd6df';

interface ResolvedViewport {
  start: number;
  end: number;
  /** end - start, the number of visible columns. */
  width: number;
}

function resolveViewport(state: MSAZoneState, msa: MSA): ResolvedViewport {
  if (state.viewportEnd > state.viewportStart) {
    const start = Math.max(0, state.viewportStart);
    const end = Math.min(msa.length, state.viewportEnd);
    return { start, end, width: Math.max(1, end - start) };
  }
  return { start: 0, end: msa.length, width: Math.max(1, msa.length) };
}

const MSAHeader = ({
  data,
  zoneState,
  setZoneState,
}: ZoneRenderProps<MSAZoneState>) => {
  const msa = data.msa;
  const vp = msa ? resolveViewport(zoneState, msa) : null;

  const setViewport = useCallback(
    (start: number, end: number) =>
      setZoneState((s) => ({ ...s, viewportStart: start, viewportEnd: end })),
    [setZoneState],
  );

  return (
    <div
      style={{
        padding: '0 10px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: '#333',
      }}
    >
      <span style={{ fontWeight: 600 }}>MSA</span>
      {msa && vp && (
        <>
          <span style={{ fontWeight: 400, color: '#888', fontSize: 11 }}>{msa.alphabet}</span>
          <span
            style={{
              fontWeight: 400,
              color: '#888',
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
          >
            {vp.start + 1}–{vp.end} / {msa.length}
          </span>
          <SchemeSelect msa={msa} zoneState={zoneState} setZoneState={setZoneState} />
          <Minimap msa={msa} vp={vp} onSetViewport={setViewport} />
        </>
      )}
    </div>
  );
};

function SchemeSelect({
  msa,
  zoneState,
  setZoneState,
}: {
  msa: MSA;
  zoneState: MSAZoneState;
  setZoneState: ZoneRenderProps<MSAZoneState>['setZoneState'];
}) {
  const schemes = applicableSchemes(msa.alphabet);
  const selectedId = zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet);
  return (
    <select
      value={selectedId}
      onChange={(e) =>
        setZoneState((s) => ({ ...s, colorSchemeId: e.target.value as ColorSchemeId }))
      }
      style={{
        fontSize: 11,
        padding: '1px 4px',
        border: '1px solid #ccc',
        borderRadius: 3,
        background: 'white',
        color: '#333',
        cursor: 'pointer',
      }}
      title="Color scheme"
    >
      {schemes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

const MSABody = ({
  data,
  visibleRows,
  rowRange,
  width,
  zoneState,
  setZoneState,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  onHoverNode,
  onSelectNode,
}: ZoneRenderProps<MSAZoneState>) => {
  const msa = data.msa;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = useMemo(
    () =>
      visibleRows.length > 0
        ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
        : 0,
    [visibleRows],
  );

  // Re-paint whenever the inputs that affect the canvas change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !msa || width <= 0 || totalHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(totalHeight * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, totalHeight);

    const vp = resolveViewport(zoneState, msa);
    const innerWidth = Math.max(1, width - 2 * PAD_X);
    const residueWidth = innerWidth / vp.width;
    const scheme = getScheme(zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet));

    const renderText = residueWidth >= TEXT_RENDER_MIN_PX;
    if (renderText) {
      ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
    }

    const startIdx = rowRange.startIndex;
    const endIdx = Math.min(rowRange.endIndex, visibleRows.length);
    for (let i = startIdx; i < endIdx; i++) {
      const r = visibleRows[i];
      if (r.kind !== 'leaf') continue;
      const node = data.tree.nodes[r.nodeId];
      if (!node?.geneId) continue;
      const seq = msa.sequences[node.geneId];
      if (!seq) continue;

      const rowYCenter = r.y + r.height / 2;
      const rowOpacity = r.opacity ?? 1;
      const rowTx = -32 * (1 - rowOpacity);
      ctx.globalAlpha = rowOpacity;
      ctx.save();
      ctx.translate(rowTx, 0);
      if (renderText) {
        for (let col = vp.start; col < vp.end; col++) {
          const ch = seq[col];
          if (!ch || ch === '-') continue;
          ctx.fillStyle = scheme.color(ch) ?? RESIDUE_COLOR;
          const x = PAD_X + (col - vp.start + 0.5) * residueWidth;
          ctx.fillText(ch, x, rowYCenter);
        }
      } else {
        for (let col = vp.start; col < vp.end; col++) {
          const ch = seq[col];
          if (!ch || ch === '-') continue;
          ctx.fillStyle = scheme.color(ch) ?? RESIDUE_BG_COLOR;
          const x = PAD_X + (col - vp.start) * residueWidth;
          ctx.fillRect(x, r.y + 2, Math.max(residueWidth, 0.5), r.height - 4);
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }, [
    msa,
    visibleRows,
    rowRange.startIndex,
    rowRange.endIndex,
    width,
    totalHeight,
    zoneState.viewportStart,
    zoneState.viewportEnd,
    zoneState.colorSchemeId,
    data.tree,
  ]);

  // Wheel handler: deltaX → pan, ctrl/shift + deltaY → zoom centred on cursor.
  // Has to be attached via native addEventListener (passive: false) because
  // React's synthetic onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !msa) return;
    const handler = (e: WheelEvent) => {
      const vp = resolveViewport(zoneState, msa);
      const innerWidth = Math.max(1, width - 2 * PAD_X);
      const length = vp.end - vp.start;

      if (e.ctrlKey || e.shiftKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - PAD_X;
        const clamped = Math.max(0, Math.min(innerWidth, cursorX));
        const cursorCol = vp.start + (clamped / innerWidth) * length;
        const factor = Math.exp(e.deltaY * 0.002);
        let newLength = Math.round(length * factor);
        newLength = Math.max(2, Math.min(msa.length, newLength));
        let newStart = Math.round(cursorCol - (clamped / innerWidth) * newLength);
        newStart = Math.max(0, Math.min(msa.length - newLength, newStart));
        setZoneState((s) => ({
          ...s,
          viewportStart: newStart,
          viewportEnd: newStart + newLength,
        }));
        return;
      }

      if (e.deltaX !== 0) {
        e.preventDefault();
        const panSpeed = length / innerWidth;
        let newStart = Math.round(vp.start + e.deltaX * panSpeed);
        newStart = Math.max(0, Math.min(msa.length - length, newStart));
        if (newStart === vp.start) return;
        setZoneState((s) => ({
          ...s,
          viewportStart: newStart,
          viewportEnd: newStart + length,
        }));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [msa, width, zoneState.viewportStart, zoneState.viewportEnd, setZoneState]);

  if (!msa) {
    return (
      <div style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>
        No alignment provided
      </div>
    );
  }

  // Render row-aligned hit overlays (for hover/select) on top of the canvas.
  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height: totalHeight,
          pointerEvents: 'none',
        }}
      />
      {rows.map((r) => {
        const isExactHover = hoveredNodeId === r.nodeId;
        const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
        const isSelected = selectedNodeId === r.nodeId;
        return (
          <div
            key={r.nodeId}
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
            onClick={() => onSelectNode(r.nodeId)}
            style={{
              position: 'absolute',
              top: r.y,
              left: 0,
              right: 0,
              height: r.height,
              cursor: 'pointer',
              background: isSelected
                ? 'rgba(40, 120, 220, 0.12)'
                : isExactHover
                  ? 'rgba(40, 120, 220, 0.06)'
                  : isInHoveredSubtree
                    ? 'rgba(40, 120, 220, 0.03)'
                    : 'transparent',
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              opacity: r.opacity ?? 1,
              transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
            }}
          />
        );
      })}
    </div>
  );
};

export const msaZone: ZoneDefinition<MSAZoneState> = {
  id: 'msa',
  displayName: 'MSA',
  Header: MSAHeader,
  Body: MSABody,
  defaultWidth: 360,
  minWidth: 120,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) => Boolean(data.msa),
};

// Helpers referenced from sibling files in later slices (minimap, pan/zoom).
export { resolveViewport };
export type { ResolvedViewport };
