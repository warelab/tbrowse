import { useEffect, useRef, useState } from 'react';
import type { ResolvedViewport } from './MSA';

const VIEWPORT_FILL = 'rgba(40, 120, 220, 0.18)';
const VIEWPORT_STROKE = 'rgb(54 0 255)';

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

    const colWidth = width / totalCols;
    const drawWidth = Math.max(colWidth, 0.5);
    for (let c = 0; c < totalCols; c++) {
      const color = colors[c];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(c * colWidth, 0, drawWidth, effectiveH);
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
        background: '#f0f2f4',
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
    </div>
  );
}
