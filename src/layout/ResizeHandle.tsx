import { useTBrowseStore } from '../store';

/**
 * Inter-zone column resizer. Zones are laid out as fr-shares of the
 * container width, so a drag adjusts THIS zone's fr +Δ and the NEXT
 * zone's fr −Δ — total fr is preserved, the grid stays exactly the
 * container width, and only these two zones change pixel size.
 *
 * The handle is omitted on the rightmost zone (no neighbour to take
 * from). Δ is clamped so neither side drops below its declared
 * `minWidth`.
 */
export function ResizeHandle({
  zoneId,
  nextZoneId,
  currentFr,
  nextFr,
  sumFr,
  containerWidth,
  minWidth,
  nextMinWidth,
}: {
  zoneId: string;
  nextZoneId: string;
  currentFr: number;
  nextFr: number;
  sumFr: number;
  containerWidth: number;
  minWidth: number;
  nextMinWidth: number;
}) {
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (sumFr <= 0 || containerWidth <= 0) return;
    const startX = e.clientX;
    const startFr = currentFr;
    const startNextFr = nextFr;
    // pixels-per-fr at drag start; the user expects 1px drag to move the
    // boundary by 1px regardless of the underlying fr scale.
    const frPerPx = sumFr / containerWidth;
    // Clamp range for Δfr derived from the two zones' min pixel widths.
    const minFr = minWidth * frPerPx;
    const minNextFr = nextMinWidth * frPerPx;
    const minDeltaFr = minFr - startFr; // can shrink this zone down to its min
    const maxDeltaFr = startNextFr - minNextFr; // can shrink the NEXT zone down to its min

    const onMove = (ev: PointerEvent) => {
      let deltaFr = (ev.clientX - startX) * frPerPx;
      if (deltaFr < minDeltaFr) deltaFr = minDeltaFr;
      if (deltaFr > maxDeltaFr) deltaFr = maxDeltaFr;
      setViewState((vs) => ({
        ...vs,
        zones: vs.zones.map((z) => {
          if (z.id === zoneId) return { ...z, width: startFr + deltaFr };
          if (z.id === nextZoneId) return { ...z, width: startNextFr - deltaFr };
          return z;
        }),
      }));
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
      className="tbrowse-resize-handle"
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 6,
        height: '100%',
        cursor: 'col-resize',
        userSelect: 'none',
        touchAction: 'none',
      }}
    />
  );
}
