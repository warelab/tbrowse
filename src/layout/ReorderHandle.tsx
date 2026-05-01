import { useTBrowseStore } from '../store';
import type { ZoneViewState } from '../types';

interface ReorderHandleProps {
  zoneId: string;
  visibleZones: ZoneViewState[];
  gridRef: React.RefObject<HTMLDivElement>;
  setDragState: (
    s:
      | { zoneId: string; fromIndex: number; targetIndex: number; cursorX: number }
      | null,
  ) => void;
}

export function ReorderHandle({
  zoneId,
  visibleZones,
  gridRef,
  setDragState,
}: ReorderHandleProps) {
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const fromIndex = visibleZones.findIndex((z) => z.id === zoneId);
    if (fromIndex < 0) return;

    let lastTarget = fromIndex;
    setDragState({
      zoneId,
      fromIndex,
      targetIndex: fromIndex,
      cursorX: e.clientX,
    });

    const computeTargetIndex = (clientX: number): number => {
      const grid = gridRef.current;
      if (!grid) return fromIndex;
      const rect = grid.getBoundingClientRect();
      const relX = clientX - rect.left + grid.scrollLeft;
      let cumulative = 0;
      for (let i = 0; i < visibleZones.length; i++) {
        const w = visibleZones[i].width;
        if (relX < cumulative + w / 2) return i;
        cumulative += w;
      }
      return visibleZones.length;
    };

    const onMove = (ev: PointerEvent) => {
      const target = computeTargetIndex(ev.clientX);
      lastTarget = target;
      setDragState({
        zoneId,
        fromIndex,
        targetIndex: target,
        cursorX: ev.clientX,
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragState(null);

      if (lastTarget !== fromIndex && lastTarget !== fromIndex + 1) {
        setViewState((vs) => {
          const visibleIds = visibleZones.map((z) => z.id);
          const movedId = visibleIds[fromIndex];

          // Reorder within the visible subset.
          const reorderedVisible = [...visibleIds];
          reorderedVisible.splice(fromIndex, 1);
          reorderedVisible.splice(
            lastTarget > fromIndex ? lastTarget - 1 : lastTarget,
            0,
            movedId,
          );

          // Map back into the full zones array, preserving hidden zones in place.
          const result: typeof vs.zones = [];
          let visibleCursor = 0;
          for (const z of vs.zones) {
            if (!z.visible) {
              result.push(z);
              continue;
            }
            const nextVisibleId = reorderedVisible[visibleCursor++];
            const matched = vs.zones.find((x) => x.id === nextVisibleId)!;
            result.push(matched);
          }
          return { ...vs, zones: result };
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="tbrowse-reorder-handle"
      onPointerDown={onPointerDown}
      title="Drag to reorder"
      style={{
        width: 14,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        color: 'var(--tbrowse-text-subtle)',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1 }}>⋮⋮</span>
    </div>
  );
}
