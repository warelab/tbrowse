import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MaskParams {
  enabled: boolean;
  minCoverage: number;
  padding: number;
}

interface MaskPanelProps {
  params: MaskParams;
  /** Total active leaves, used as max for the minCoverage input. */
  maxCoverage: number;
  /** How many cols would the current mask hide? Shown as a status line. */
  hiddenCols: number;
  totalCols: number;
  onChange: (next: MaskParams) => void;
}

export function MaskPanel({
  params,
  maxCoverage,
  hiddenCols,
  totalCols,
  onChange,
}: MaskPanelProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const togglePanel = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.bottom + 4 });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-msa-mask-panel');
      if (popover?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const active = params.enabled && params.minCoverage > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        title="Column mask"
        style={{
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 3,
          border: `1px solid ${active ? '#2878dc' : '#ccc'}`,
          background: open ? '#e6f0fb' : active ? '#f4f8fd' : 'white',
          color: active ? '#1d5fb1' : '#333',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Mask{active ? ` (${hiddenCols})` : ''}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="tbrowse-msa-mask-panel"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              padding: '10px 12px',
              zIndex: 1000,
              minWidth: 240,
              fontSize: 12,
              color: '#222',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: '#888',
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Column mask
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={params.enabled}
                onChange={(e) => onChange({ ...params, enabled: e.target.checked })}
              />
              Enabled
            </label>

            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ color: '#666' }}>Min coverage</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, maxCoverage)}
                  step={1}
                  value={params.minCoverage}
                  disabled={!params.enabled}
                  onChange={(e) => {
                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    onChange({ ...params, minCoverage: n });
                  }}
                  style={{ width: 60, fontSize: 12, padding: '1px 4px' }}
                />
                <span style={{ color: '#999' }}>/ {maxCoverage} leaves</span>
              </div>
              <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                Drop a column unless at least this many active leaves have a
                non-gap residue there.
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ color: '#666' }}>Padding</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={params.padding}
                  disabled={!params.enabled}
                  onChange={(e) => {
                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    onChange({ ...params, padding: n });
                  }}
                  style={{ width: 60, fontSize: 12, padding: '1px 4px' }}
                />
                <span style={{ color: '#999' }}>cols</span>
              </div>
              <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                Keep this many columns flanking each covered region so brief
                low-coverage runs don't break a contiguous block.
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                paddingTop: 8,
                borderTop: '1px solid #eee',
                color: '#666',
                fontSize: 11,
              }}
            >
              {hiddenCols > 0
                ? `Hiding ${hiddenCols} of ${totalCols} columns.`
                : `All ${totalCols} columns visible.`}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
