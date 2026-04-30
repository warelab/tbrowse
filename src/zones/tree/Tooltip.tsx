import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HostData, NodeId, TreeNode } from '../../types';
import type { TreeLayoutNode } from './layout';

const COLOR_PRIMARY = '#2878dc';
const COLOR_DANGER = '#c0392b';
const COLOR_MUTED = '#666';

export interface TooltipProps {
  /** SVG element the layout coordinates are relative to. */
  svgRef: React.RefObject<SVGSVGElement>;
  /** Layout-resolved node providing local (x, y) for anchor. */
  layoutNode: TreeLayoutNode;
  /** Source-of-truth node from the host tree (richer fields). */
  treeNode: TreeNode;
  data: HostData;
  isCollapsed: boolean;
  isPruned: boolean;
  isNodeOfInterest: boolean;
  subtreeLeafCount: number;
  hasCollapsedDescendants: boolean;
  onClose: () => void;
  onToggleCollapsed: (id: NodeId) => void;
  onTogglePruned: (id: NodeId) => void;
  onToggleSwapped: (id: NodeId) => void;
  onExpandSubtree: (id: NodeId) => void;
  onMakeNodeOfInterest: (id: NodeId) => void;
  onShowParalogs: (id: NodeId) => void;
}

export function Tooltip({
  svgRef,
  layoutNode,
  treeNode,
  data,
  isCollapsed,
  isPruned,
  isNodeOfInterest,
  subtreeLeafCount,
  hasCollapsedDescendants,
  onClose,
  onToggleCollapsed,
  onTogglePruned,
  onToggleSwapped,
  onExpandSubtree,
  onMakeNodeOfInterest,
  onShowParalogs,
}: TooltipProps) {
  const screenPos = useTrackedScreenPos(svgRef, layoutNode.x, layoutNode.y);

  // User drag offset (relative to the anchor) and a measured size of the
  // tooltip element. These let us clamp the tooltip into the viewport even
  // when the anchor is near the bottom of the screen, and let the user
  // reposition by dragging the header.
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Measure tooltip dimensions after every render. Conditionally update so
  // we don't loop on identical sizes.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (Math.abs(rect.width - size.w) > 0.5 || Math.abs(rect.height - size.h) > 0.5) {
      setSize({ w: rect.width, h: rect.height });
    }
  });

  const onDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, label')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startDX = dragOffset.dx;
    const startDY = dragOffset.dy;
    const onMove = (ev: PointerEvent) => {
      setDragOffset({
        dx: startDX + (ev.clientX - startX),
        dy: startDY + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!screenPos) return null;

  // Compute final on-screen position: anchor + drag, clamped to viewport.
  const margin = 8;
  const w = size.w || 220;
  const h = size.h || 100;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
  const rawX = screenPos.x + 10 + dragOffset.dx;
  const rawY = screenPos.y - 8 + dragOffset.dy;
  const finalX = Math.max(margin, Math.min(viewportW - w - margin, rawX));
  const finalY = Math.max(margin, Math.min(viewportH - h - margin, rawY));

  const tax = treeNode.taxonomyId !== undefined ? data.taxonomy?.[treeNode.taxonomyId] : undefined;

  const isInternal = !treeNode.isLeaf;
  const isLeaf = treeNode.isLeaf;
  const canCollapseExpand = isInternal && !isPruned;
  const canShowParalogs =
    isLeaf && isNodeOfInterest && treeNode.taxonomyId !== undefined && !isPruned;
  const canMakeNodeOfInterest = isLeaf && !isNodeOfInterest && !isPruned;

  return createPortal(
    <div
      ref={tooltipRef}
      className="tbrowse-tooltip"
      style={{
        position: 'fixed',
        left: finalX,
        top: finalY,
        minWidth: 200,
        maxWidth: 320,
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '8px 10px',
        fontSize: 12,
        lineHeight: 1.45,
        color: '#222',
        zIndex: 1000,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onDragStart}
        title="Drag to reposition"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          marginBottom: 6,
          cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {tax?.scientificName ?? treeNode.geneId ?? layoutNode.nodeId}
          </div>
          {tax?.commonName && (
            <div style={{ color: COLOR_MUTED, fontStyle: 'italic' }}>{tax.commonName}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: COLOR_MUTED,
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            marginTop: -2,
          }}
        >
          ×
        </button>
      </div>
      <InfoRow label="Node id" value={layoutNode.nodeId} mono />
      {treeNode.geneId && <InfoRow label="Gene id" value={treeNode.geneId} mono />}
      {treeNode.eventType && <InfoRow label="Event" value={treeNode.eventType} />}
      {treeNode.bootstrap !== undefined && (
        <InfoRow label="Bootstrap" value={String(treeNode.bootstrap)} />
      )}
      {treeNode.parentId !== null && (
        <InfoRow label="Distance" value={treeNode.distance.toFixed(4)} />
      )}
      {isInternal && <InfoRow label="Leaves" value={String(subtreeLeafCount)} />}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid #eee',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {canCollapseExpand && (
          <ActionButton
            label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={() => {
              onToggleCollapsed(layoutNode.nodeId);
              onClose();
            }}
          />
        )}
        {isInternal && !isPruned && !isCollapsed && hasCollapsedDescendants && (
          <ActionButton
            label="Expand all"
            onClick={() => {
              onExpandSubtree(layoutNode.nodeId);
              onClose();
            }}
          />
        )}
        {isInternal && !isPruned && !isCollapsed && (
          <ActionButton
            label="Swap children"
            onClick={() => {
              onToggleSwapped(layoutNode.nodeId);
              onClose();
            }}
          />
        )}
        {canMakeNodeOfInterest && (
          <ActionButton
            label="Make node of interest"
            onClick={() => {
              onMakeNodeOfInterest(layoutNode.nodeId);
              onClose();
            }}
          />
        )}
        {canShowParalogs && (
          <ActionButton
            label="Show paralogs"
            onClick={() => {
              onShowParalogs(layoutNode.nodeId);
              onClose();
            }}
          />
        )}
        <ActionButton
          label={isPruned ? 'Regrow' : 'Prune'}
          color={isPruned ? COLOR_PRIMARY : COLOR_DANGER}
          onClick={() => {
            onTogglePruned(layoutNode.nodeId);
            onClose();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: COLOR_MUTED, minWidth: 70 }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? 'ui-monospace, SF Mono, Menlo, monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  color = '#333',
}: {
  label: string;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'white',
        border: `1px solid ${color}`,
        color,
        borderRadius: 4,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Track the on-screen position of a point at SVG-local (x, y), updating as the
 * SVG moves due to scroll, column resize, reorder, or window resize. Uses a
 * requestAnimationFrame loop so the cause of motion does not need to be
 * enumerated; only triggers React re-render when the position actually changes.
 */
function useTrackedScreenPos(
  svgRef: React.RefObject<SVGSVGElement>,
  localX: number,
  localY: number,
): { x: number; y: number } | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    let rafId = 0;
    const tick = () => {
      const rect = svg.getBoundingClientRect();
      const next = { x: rect.left + localX, y: rect.top + localY };
      const last = lastRef.current;
      if (!last || last.x !== next.x || last.y !== next.y) {
        lastRef.current = next;
        setPos(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(rafId);
  }, [svgRef, localX, localY]);

  return pos;
}
