import { useEffect, useMemo, useRef, useState } from 'react';
import type { MSA } from '../../types';
import { computeColumnCoverage } from './coverage';
import type { ResolvedViewport } from './MSA';

const COVERAGE_COLOR = 'rgba(80, 110, 140, 0.85)';
const VIEWPORT_FILL = 'rgba(40, 120, 220, 0.18)';
const VIEWPORT_STROKE = '#2878dc';

interface MinimapProps {
  msa: MSA;
  vp: ResolvedViewport;
  onSetViewport: (start: number, end: number) => void;
  height?: number;
}

export function Minimap({ msa, vp, onSetViewport, height = 28 }: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const coverage = useMemo(() => computeColumnCoverage(msa), [msa]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const colWidth = width / msa.length;
    ctx.fillStyle = COVERAGE_COLOR;
    for (let c = 0; c < msa.length; c++) {
      const cov = coverage[c];
      if (cov <= 0) continue;
      const barHeight = Math.max(1, cov * (height - 4));
      const x = c * colWidth;
      const y = (height - barHeight) / 2;
      ctx.globalAlpha = 0.4 + cov * 0.5;
      ctx.fillRect(x, y, Math.max(colWidth, 0.5), barHeight);
    }
    ctx.globalAlpha = 1;
  }, [width, height, msa, coverage]);

  const vpStartPx = (vp.start / msa.length) * width;
  const vpWidthPx = Math.max(2, ((vp.end - vp.start) / msa.length) * width);

  const onPointerDownRect = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const initialStart = vp.start;
    const length = vp.end - vp.start;
    const containerWidth = width;

    const onMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientX - startX;
      const deltaCols = (deltaPx / containerWidth) * msa.length;
      let newStart = Math.round(initialStart + deltaCols);
      newStart = Math.max(0, Math.min(msa.length - length, newStart));
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
    if (!containerRef.current || width <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetCol = Math.round((clickX / width) * msa.length);
    const length = vp.end - vp.start;
    let newStart = targetCol - Math.floor(length / 2);
    newStart = Math.max(0, Math.min(msa.length - length, newStart));
    onSetViewport(newStart, newStart + length);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDownContainer}
      style={{
        position: 'relative',
        flex: 1,
        height,
        minWidth: 60,
        cursor: 'pointer',
        borderRadius: 2,
        overflow: 'hidden',
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
          height,
          background: VIEWPORT_FILL,
          border: `1px solid ${VIEWPORT_STROKE}`,
          borderRadius: 2,
          cursor: 'grab',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}
