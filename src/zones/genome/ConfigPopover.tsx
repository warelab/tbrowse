import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import { GearIcon } from '../../icons/GearIcon';
import type { GenomeFeature, ZoneRenderProps } from '../../types';
import type { GenomeZoneState } from './Genome';

interface GenomeConfigPopoverProps {
  zoneState: GenomeZoneState;
  setZoneState: ZoneRenderProps<GenomeZoneState>['setZoneState'];
  /** Per-leaf feature data; the popover builds the kind list from
   *  this so the user only sees toggles for kinds that actually
   *  exist in the loaded host data. */
  genomeFeatures: Record<string, GenomeFeature[]> | undefined;
}

/**
 * Standardised gear-icon popover for the genome zone — mirrors the
 * Labels / MSA / Table pattern. Lets the user toggle which proximal
 * feature kinds (TFBS, CpG, enhancer, etc.) appear in each row's
 * feature track and adjust the ±kb padding numeric inline.
 */
export function GenomeConfigPopover({
  zoneState,
  setZoneState,
  genomeFeatures,
}: GenomeConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    right: number;
    top: number;
    maxWidth: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const theme = useTBrowseStore((s) => s.theme);

  // Discover the set of feature kinds present in the host data, with
  // counts so the popover can show "TFBS (12)" etc. Recomputed only
  // when `genomeFeatures` changes — independent of which kinds are
  // currently visible.
  const kindStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const arr of Object.values(genomeFeatures ?? {})) {
      for (const f of arr) {
        counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [genomeFeatures]);

  // `visibleFeatureKinds: null` means "all kinds visible" (the
  // default). Resolve to a concrete Set on every render so toggling
  // logic doesn't have to special-case the null sentinel.
  const allKinds = kindStats.map(([k]) => k);
  const visibleSet = new Set(zoneState.visibleFeatureKinds ?? allKinds);

  const togglePopover = () => {
    if (!open && buttonRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const zoneEl = buttonRef.current.closest<HTMLElement>(
        '[data-genome-zone-header]',
      );
      const zoneRect = zoneEl?.getBoundingClientRect();
      const right = zoneRect
        ? Math.max(0, window.innerWidth - zoneRect.right)
        : Math.max(0, window.innerWidth - btnRect.right);
      const zoneWidth = zoneRect ? zoneRect.right - zoneRect.left : 240;
      const maxWidth = Math.max(220, zoneWidth);
      setAnchor({ right, top: btnRect.bottom + 4, maxWidth });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-genome-config');
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

  const setVisibleKinds = (next: string[] | null) =>
    setZoneState((s) => ({
      ...s,
      visibleFeatureKinds: next,
    }));

  const toggleKind = (kind: string) => {
    const next = new Set(visibleSet);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    // Collapse back to `null` (the all-visible sentinel) when the
    // user has every kind selected — keeps the URL state minimal.
    if (next.size === allKinds.length) setVisibleKinds(null);
    else setVisibleKinds(allKinds.filter((k) => next.has(k)));
  };

  const setPaddingKb = (v: number) =>
    setZoneState((s) => ({ ...s, paddingKb: Math.max(0, v) }));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title="Configure genome zone"
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
              className="tbrowse-genome-config"
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
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                }}
              >
                <span>Proximal features</span>
                {kindStats.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setVisibleKinds(null)}
                    disabled={zoneState.visibleFeatureKinds === null}
                    style={{
                      fontSize: 10,
                      padding: '0 4px',
                      border: '1px solid var(--tbrowse-border)',
                      borderRadius: 3,
                      background: 'var(--tbrowse-bg-input)',
                      color: 'var(--tbrowse-text)',
                      cursor: 'pointer',
                      letterSpacing: 0,
                      textTransform: 'none',
                      fontWeight: 400,
                      opacity:
                        zoneState.visibleFeatureKinds === null ? 0.5 : 1,
                    }}
                    title="Show every feature kind"
                  >
                    all
                  </button>
                )}
              </div>
              {kindStats.length === 0 ? (
                <div
                  style={{
                    color: 'var(--tbrowse-text-muted)',
                    fontSize: 11,
                    fontStyle: 'italic',
                    marginBottom: 12,
                  }}
                >
                  No feature data on this tree.
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  {kindStats.map(([kind, count]) => {
                    const checked = visibleSet.has(kind);
                    return (
                      <label
                        key={kind}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '3px 0',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKind(kind)}
                        />
                        <span style={{ flex: 1 }}>{kind}</span>
                        <span
                          style={{
                            color: 'var(--tbrowse-text-subtle)',
                            fontSize: 11,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {count.toLocaleString()}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
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
                Window padding
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                }}
                title="Used by the ±kb padding mode."
              >
                <span style={{ color: 'var(--tbrowse-text-muted)' }}>±</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={zoneState.paddingKb}
                  onChange={(e) => setPaddingKb(Number(e.target.value) || 0)}
                  style={{ width: 70, fontSize: 12, padding: '1px 4px' }}
                />
                <span style={{ color: 'var(--tbrowse-text-subtle)' }}>kb</span>
              </label>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
