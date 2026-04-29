import { useTBrowseStore } from '../store';

export function ResizeHandle({
  zoneId,
  currentWidth,
  minWidth,
}: {
  zoneId: string;
  currentWidth: number;
  minWidth: number;
}) {
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = currentWidth;

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(minWidth, startWidth + (ev.clientX - startX));
      setViewState((vs) => ({
        ...vs,
        zones: vs.zones.map((z) => (z.id === zoneId ? { ...z, width: next } : z)),
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
