import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import {
  applicableSchemes,
  defaultSchemeFor,
  type ColorSchemeId,
} from './coloring';
import type { MSA, ZoneRenderProps } from '../../types';
import type { MSAZoneState } from './MSA';
import { GearIcon } from '../../icons/GearIcon';

export interface MaskParams {
  enabled: boolean;
  minCoverage: number;
  padding: number;
  expandedRuns?: number[];
}

interface MSAConfigPopoverProps {
  msa: MSA;
  zoneState: MSAZoneState;
  setZoneState: ZoneRenderProps<MSAZoneState>['setZoneState'];
  /** True when the host has supplied any protein-domain hits. Switches
   *  the built-in "Plain" scheme's label to "Domains" so its meaning
   *  is obvious. */
  hasDomains: boolean;
  /** Mask metrics surfaced inside the popover. */
  mask: {
    params: MaskParams;
    maxCoverage: number;
    hiddenCols: number;
    totalCols: number;
    onChange: (next: MaskParams) => void;
  };
}

/**
 * Single gear-icon control that opens a portaled popover containing
 * the color-scheme selector and the column-mask configuration. The
 * popover anchors to the host MSA zone's bounds (matching the table
 * zone's pattern) — its right edge lines up with the zone's right
 * edge and its width is capped at the zone's width so it never spills
 * into a neighbouring zone.
 */
export function MSAConfigPopover({
  msa,
  zoneState,
  setZoneState,
  hasDomains,
  mask,
}: MSAConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    right: number;
    top: number;
    maxWidth: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Element the popover is portaled into. Prefer the chassis root — it sits
  // inside whatever fullscreen / modal subtree the host has wrapped TBrowse in,
  // so the popover (and its color-scheme select) stays visible and on top.
  // `document.body` escapes that stacking context: under a host fullscreen
  // modal the popover lands behind it, and under the browser Fullscreen API it
  // isn't rendered at all. Captured on open.
  const portalHostRef = useRef<HTMLElement | null>(null);
  const theme = useTBrowseStore((s) => s.theme);

  const togglePopover = () => {
    if (!open && buttonRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const zoneEl = buttonRef.current.closest<HTMLElement>(
        '[data-msa-zone-header]',
      );
      const zoneRect = zoneEl?.getBoundingClientRect();
      const right = zoneRect
        ? Math.max(0, window.innerWidth - zoneRect.right)
        : Math.max(0, window.innerWidth - btnRect.right);
      const zoneWidth = zoneRect ? zoneRect.right - zoneRect.left : 320;
      const maxWidth = Math.max(240, zoneWidth);
      portalHostRef.current =
        buttonRef.current.closest<HTMLElement>('.tbrowse-root') ??
        document.body;
      setAnchor({ right, top: btnRect.bottom + 4, maxWidth });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-msa-config');
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

  const schemes = applicableSchemes(msa.alphabet);
  const selectedSchemeId =
    zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet);
  const labelFor = (id: ColorSchemeId, fallback: string) =>
    id === 'plain' && hasDomains ? 'Domains' : fallback;

  const params = mask.params;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title="Configure colors and column mask"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 6px',
          borderRadius: 3,
          border: '1px solid var(--tbrowse-border)',
          background: open
            ? 'var(--tbrowse-accent-soft)'
            : 'var(--tbrowse-bg-input)',
          color: 'var(--tbrowse-text)',
          cursor: 'pointer',
        }}
      >
        <GearIcon />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div className={`tbrowse-root tbrowse-theme-${theme}`}>
            <div
              className="tbrowse-msa-config"
              style={{
                position: 'fixed',
                right: anchor.right,
                top: anchor.top,
                boxSizing: 'border-box',
                background: 'var(--tbrowse-bg-elevated)',
                border: '1px solid var(--tbrowse-border)',
                color: 'var(--tbrowse-text)',
                borderRadius: 6,
                boxShadow: '0 4px 16px var(--tbrowse-tooltip-shadow)',
                padding: '10px 12px',
                zIndex: 2000,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: 'var(--tbrowse-text-subtle)',
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Color scheme
              </div>
              <select
                value={selectedSchemeId}
                onChange={(e) =>
                  setZoneState((s) => ({
                    ...s,
                    colorSchemeId: e.target.value as ColorSchemeId,
                  }))
                }
                style={{
                  fontSize: 12,
                  padding: '2px 6px',
                  border: '1px solid var(--tbrowse-border)',
                  borderRadius: 3,
                  background: 'var(--tbrowse-bg-input)',
                  color: 'var(--tbrowse-text)',
                  cursor: 'pointer',
                  width: '100%',
                  marginBottom: 12,
                }}
              >
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {labelFor(s.id, s.label)}
                  </option>
                ))}
              </select>

              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: 'var(--tbrowse-text-subtle)',
                  fontWeight: 600,
                  marginBottom: 6,
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
                  onChange={(e) =>
                    mask.onChange({ ...params, enabled: e.target.checked })
                  }
                />
                Enabled
              </label>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: 'var(--tbrowse-text-muted)' }}>
                    Min coverage
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, mask.maxCoverage)}
                    step={1}
                    value={params.minCoverage}
                    disabled={!params.enabled}
                    onChange={(e) => {
                      const n = Math.max(
                        0,
                        Math.floor(Number(e.target.value) || 0),
                      );
                      mask.onChange({ ...params, minCoverage: n });
                    }}
                    style={{ width: 60, fontSize: 12, padding: '1px 4px' }}
                  />
                  <span style={{ color: 'var(--tbrowse-text-subtle)' }}>
                    / {mask.maxCoverage} leaves
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--tbrowse-text-muted)',
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  Drop a column unless at least this many active leaves
                  have a non-gap residue there.
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: 'var(--tbrowse-text-muted)' }}>
                    Padding
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={params.padding}
                    disabled={!params.enabled}
                    onChange={(e) => {
                      const n = Math.max(
                        0,
                        Math.floor(Number(e.target.value) || 0),
                      );
                      mask.onChange({ ...params, padding: n });
                    }}
                    style={{ width: 60, fontSize: 12, padding: '1px 4px' }}
                  />
                  <span style={{ color: 'var(--tbrowse-text-subtle)' }}>
                    cols
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--tbrowse-text-muted)',
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  Keep this many columns flanking each covered region so
                  brief low-coverage runs don't break a contiguous block.
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--tbrowse-border-soft)',
                  color: 'var(--tbrowse-text-muted)',
                  fontSize: 11,
                }}
              >
                {mask.hiddenCols > 0
                  ? `Hiding ${mask.hiddenCols} of ${mask.totalCols} columns.`
                  : `All ${mask.totalCols} columns visible.`}
              </div>
            </div>
          </div>,
          portalHostRef.current ?? document.body,
        )}
    </>
  );
}
