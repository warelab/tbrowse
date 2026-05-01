import { useEffect, useRef, useState } from 'react';
import type { ResolvedViewport } from './MSA';

const VIEWPORT_FILL = 'rgba(40, 120, 220, 0.18)';
const VIEWPORT_STROKE = 'rgb(54 0 255)';
/** Pixel width of the draggable edge handles (centered on each viewport edge). */
const EDGE_HANDLE_WIDTH = 10;

interface MinimapProps {
  /** One entry per visible column: a CSS color for the consensus residue,
   *  or null to leave the column empty (gap consensus). */
  colors: (string | null)[];
  /** Total visible-column count the viewport units operate in (mask-aware). */
  totalCols: number;
  vp: ResolvedViewport;
  onSetViewport: (start: number, end: number) => void;
  height?: number;
  /** When provided, sizes the canvas to exactly this pixel width instead of
   *  measuring via ResizeObserver. Use this when the parent wants the minimap
   *  to align pixel-for-pixel with another element (e.g. the MSA body grid). */
  width?: number;
  /** Minimum viewport length (in columns) the edge-drag handles will allow.
   *  Defaults to 1. The MSA zone passes a larger value for protein
   *  alignments to enforce the 3-letter zoom cap. */
  minLength?: number;
}

/**
 * The MSA "consensus track": a column-for-column overview of the alignment
 * coloured by the active scheme, with a draggable viewport rectangle that
 * reflects the body's current zoom/pan. Dragging the rectangle pans; clicking
 * an empty area recenters; column units are mask-aware (they index into the
 * visible-column space, same as the body and the viewport state).
 */
export function Minimap({
  colors,
  totalCols,
  vp,
  onSetViewport,
  height,
  width: widthProp,
  minLength = 1,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const width = widthProp ?? measuredWidth;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const needWidth = widthProp === undefined;
    const needHeight = height === undefined;
    if (!needWidth && !needHeight) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (needWidth) setMeasuredWidth(r.width);
      if (needHeight) setContainerH(r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height, widthProp]);

  const effectiveH = height ?? Math.max(8, containerH);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || totalCols <= 0 || effectiveH <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(effectiveH * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${effectiveH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, effectiveH);

    // Snap each column's CSS-pixel boundaries with Math.round so adjacent
    // fills abut on integer pixels. Without this, fractional colWidth
    // (e.g. 1.5px) leaves anti-aliased seams between same-row columns —
    // visible as faint vertical lines on plain/domain colour fills.
    const colWidth = width / totalCols;
    const xAt = (c: number) => Math.round(c * colWidth);
    for (let c = 0; c < totalCols; c++) {
      const color = colors[c];
      if (!color) continue;
      ctx.fillStyle = color;
      const x0 = xAt(c);
      const w = Math.max(1, xAt(c + 1) - x0);
      ctx.fillRect(x0, 0, w, effectiveH);
    }
  }, [width, effectiveH, totalCols, colors]);

  const vpStartPx = totalCols > 0 ? (vp.start / totalCols) * width : 0;
  const vpWidthPx =
    totalCols > 0 ? Math.max(2, ((vp.end - vp.start) / totalCols) * width) : 0;

  const onPointerDownRect = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const initialStart = vp.start;
    const length = vp.end - vp.start;
    const containerWidth = width;

    const onMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientX - startX;
      const deltaCols = (deltaPx / containerWidth) * totalCols;
      let newStart = Math.round(initialStart + deltaCols);
      newStart = Math.max(0, Math.min(totalCols - length, newStart));
      onSetViewport(newStart, newStart + length);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onPointerDownContainer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || width <= 0 || totalCols <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetCol = Math.round((clickX / width) * totalCols);
    const length = vp.end - vp.start;
    let newStart = targetCol - Math.floor(length / 2);
    newStart = Math.max(0, Math.min(totalCols - length, newStart));
    onSetViewport(newStart, newStart + length);
  };

  // Edge-drag handlers. Dragging the left handle moves vp.start (keeping
  // vp.end pinned); dragging the right handle moves vp.end (keeping vp.start
  // pinned). The other end stays anchored, so dragging an edge zooms in/out
  // around that anchor — distinct from dragging the rect body, which pans.
  const onPointerDownEdge =
    (side: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const initialStart = vp.start;
      const initialEnd = vp.end;
      const containerWidth = width;
      const clampedMin = Math.max(1, Math.min(totalCols, minLength));

      const onMove = (ev: PointerEvent) => {
        const deltaPx = ev.clientX - startX;
        const deltaCols = (deltaPx / containerWidth) * totalCols;
        if (side === 'start') {
          let newStart = Math.round(initialStart + deltaCols);
          newStart = Math.max(0, Math.min(initialEnd - clampedMin, newStart));
          onSetViewport(newStart, initialEnd);
        } else {
          let newEnd = Math.round(initialEnd + deltaCols);
          newEnd = Math.max(initialStart + clampedMin, Math.min(totalCols, newEnd));
          onSetViewport(initialStart, newEnd);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDownContainer}
      style={{
        position: 'relative',
        width: widthProp !== undefined ? widthProp : '100%',
        height: height ?? '100%',
        minHeight: 12,
        cursor: 'pointer',
        // overflow:visible so the viewport rect's outline (drawn outside its
        // box) is not clipped at full-zoom, where the rect spans the entire
        // consensus track.
        overflow: 'visible',
        background: 'var(--tbrowse-bg-alt)',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
      <div
        onPointerDown={onPointerDownRect}
        style={{
          position: 'absolute',
          left: vpStartPx,
          top: 0,
          width: vpWidthPx,
          height: '100%',
          background: VIEWPORT_FILL,
          // Use outline (drawn outside the box) instead of border so the
          // visible consensus track inside the rect is the full vpWidthPx and
          // aligns pixel-for-pixel with the MSA body grid. The container's
          // overflow: hidden clips the outline at full-zoom, where the rect
          // spans the entire minimap.
          outline: `3px solid ${VIEWPORT_STROKE}`,
          // Positive offset draws the outline outside the rect, so it sits
          // around the consensus track rather than eating into it.
          outlineOffset: 0,
          cursor: 'grab',
          boxSizing: 'border-box',
        }}
      />
      {/* Left/right edge grab handles for zoom-by-edge-drag. Centered on the
          viewport outline; rendered as siblings of the rect (rather than
          children) so their pointerdown doesn't bubble through the pan
          handler. */}
      <div
        onPointerDown={onPointerDownEdge('start')}
        style={{
          position: 'absolute',
          left: vpStartPx - EDGE_HANDLE_WIDTH / 2,
          top: 0,
          width: EDGE_HANDLE_WIDTH,
          height: '100%',
          cursor: 'ew-resize',
        }}
      />
      <div
        onPointerDown={onPointerDownEdge('end')}
        style={{
          position: 'absolute',
          left: vpStartPx + vpWidthPx - EDGE_HANDLE_WIDTH / 2,
          top: 0,
          width: EDGE_HANDLE_WIDTH,
          height: '100%',
          cursor: 'ew-resize',
        }}
      />
    </div>
  );
}
