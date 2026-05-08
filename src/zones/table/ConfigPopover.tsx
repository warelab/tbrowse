import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import { GearIcon } from '../../icons/GearIcon';
import { AGGREGATE_METHODS, methodForKind } from './aggregators';
import {
  autoPalette,
  paletteById,
  PALETTES,
  type HeatmapDomain,
  type Palette,
} from './heatmap';
import type {
  ColumnKind,
  TableColumn,
  TableColumnOverride,
  TableDisplayMode,
  TableZoneState,
} from './types';

const DISPLAY_MODES: { id: TableDisplayMode; label: string; supports: ColumnKind[] }[] = [
  { id: 'text', label: 'Text', supports: ['number', 'boolean', 'string'] },
  { id: 'heatmap', label: 'Heatmap', supports: ['number'] },
];

const KINDS: ColumnKind[] = ['string', 'number', 'boolean'];

interface EffectiveColumnRow {
  /** Factory column. */
  base: TableColumn;
  /** Resolved fields after applying override + factory defaults. */
  hidden: boolean;
  label: string;
  kind: ColumnKind;
  display: TableDisplayMode;
  aggregateMethodId: string;
  /** True when the factory provides a hard `aggregate` override; method
   *  picker is disabled in that case. */
  aggregateLocked: boolean;
  /** Resolved searchable flag (override → factory default → false).
   *  Honoured only on string-kind columns. */
  searchable: boolean;
  /** Resolved palette for heatmap rendering, or null when the column is
   *  not numeric / has no domain. */
  palette: Palette | null;
  /** Diverging-palette midpoint, in data units. */
  paletteMidpoint: number;
  /** Domain bounds used by the heatmap, exposed so the popover can
   *  surface them in the midpoint input's hint. */
  domain: HeatmapDomain | null;
}

interface ConfigPopoverProps {
  factoryColumns: TableColumn[];
  state: TableZoneState;
  setState: (next: TableZoneState | ((prev: TableZoneState) => TableZoneState)) => void;
  /** Order ids in display order, used for the "move up/down" controls. */
  orderedIds: string[];
  /** Per-column heatmap domains computed by the zone, used to surface
   *  min/max in the midpoint hint and to power the auto-palette pick. */
  heatmapDomains: Record<string, HeatmapDomain>;
}

export function ConfigPopover({
  factoryColumns,
  state,
  setState,
  orderedIds,
  heatmapDomains,
}: ConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  /** Anchored to the host zone's bounds: `right` is distance from
   *  viewport's right edge to the zone's right edge (so the popover's
   *  right edge lines up with the zone), and `maxWidth` caps the
   *  popover at the zone's width. */
  const [anchor, setAnchor] = useState<{
    right: number;
    top: number;
    maxWidth: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const theme = useTBrowseStore((s) => s.theme);

  const factoryById = new Map(factoryColumns.map((c) => [c.id, c]));

  // Build the rows in current display order; factory is the source of
  // truth for what columns exist (state.columnOrder may include stale ids).
  const rows: EffectiveColumnRow[] = orderedIds
    .map((id): EffectiveColumnRow | null => {
      const base = factoryById.get(id);
      if (!base) return null;
      const ov = state.columnOverrides?.[id] ?? {};
      const kind: ColumnKind = ov.kind ?? base.kind ?? 'string';
      const factoryDisplay = base.display ?? 'text';
      const display = ov.display ?? factoryDisplay;
      // Enforce kind/display compatibility (a heatmap on a non-numeric
      // column gets coerced to text).
      const safeDisplay: TableDisplayMode =
        DISPLAY_MODES.find((m) => m.id === display)?.supports.includes(kind)
          ? display
          : 'text';
      const aggregateLocked = !!base.aggregate;
      const aggregateMethodId = aggregateLocked
        ? '__factory__'
        : methodForKind(kind, ov.aggregateMethod).id;
      const domain = heatmapDomains[id] ?? null;
      const explicitPalette = ov.palette ?? base.palette;
      const palette = explicitPalette
        ? paletteById(explicitPalette)
        : domain
          ? autoPalette(domain)
          : null;
      const paletteMidpoint = ov.paletteMidpoint ?? base.paletteMidpoint ?? 0;
      return {
        base,
        hidden: ov.hidden ?? false,
        label: ov.label ?? base.label,
        kind,
        display: safeDisplay,
        aggregateMethodId,
        aggregateLocked,
        searchable: ov.searchable ?? base.searchable ?? false,
        palette,
        paletteMidpoint,
        domain,
      };
    })
    .filter((r): r is EffectiveColumnRow => r !== null);

  const togglePopover = () => {
    if (!open && buttonRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      // Find the host zone's outer header element so we can clamp the
      // popover to that zone's bounds. Falls back to a button-anchored
      // layout if the data attribute is missing for any reason.
      const zoneEl = buttonRef.current.closest<HTMLElement>(
        '[data-table-zone-header]',
      );
      const zoneRect = zoneEl?.getBoundingClientRect();
      const right = zoneRect
        ? Math.max(0, window.innerWidth - zoneRect.right)
        : Math.max(0, window.innerWidth - btnRect.right);
      // Strict cap: never extend past the zone's left edge. The floor
      // here is just enough room for the bulk-row's "set all" controls
      // when the zone itself is tiny — the inner content scrolls
      // horizontally past that point.
      const zoneWidth = zoneRect ? zoneRect.right - zoneRect.left : 540;
      const maxWidth = Math.max(120, zoneWidth);
      setAnchor({
        right,
        top: btnRect.bottom + 4,
        maxWidth,
      });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const popover = document.querySelector('.tbrowse-table-config');
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

  const updateOverride = (
    id: string,
    patch: Partial<TableColumnOverride> | ((prev: TableColumnOverride) => TableColumnOverride),
  ) => {
    setState((s) => {
      const prev = s.columnOverrides ?? {};
      const cur = prev[id] ?? {};
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      // Drop entries that have flattened back to "no override".
      const cleaned: TableColumnOverride = { ...next };
      (Object.keys(cleaned) as (keyof TableColumnOverride)[]).forEach((k) => {
        if (cleaned[k] === undefined) delete cleaned[k];
      });
      const isEmpty = Object.keys(cleaned).length === 0;
      const nextOverrides = { ...prev };
      if (isEmpty) delete nextOverrides[id];
      else nextOverrides[id] = cleaned;
      return { ...s, columnOverrides: nextOverrides };
    });
  };

  const moveColumn = (id: string, dir: -1 | 1) => {
    const idx = orderedIds.indexOf(id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= orderedIds.length) return;
    const next = orderedIds.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setState((s) => ({ ...s, columnOrder: next }));
  };

  const setAllVisible = (visible: boolean) => {
    setState((s) => {
      const next = { ...(s.columnOverrides ?? {}) };
      for (const r of rows) {
        const cur = next[r.base.id] ?? {};
        const merged: TableColumnOverride = { ...cur, hidden: !visible };
        if (visible) delete merged.hidden;
        if (Object.keys(merged).length === 0) delete next[r.base.id];
        else next[r.base.id] = merged;
      }
      return { ...s, columnOverrides: next };
    });
  };

  const setAllDisplay = (mode: TableDisplayMode) => {
    setState((s) => {
      const next = { ...(s.columnOverrides ?? {}) };
      for (const r of rows) {
        const supports = DISPLAY_MODES.find((m) => m.id === mode)?.supports.includes(r.kind);
        if (!supports) continue;
        const cur = next[r.base.id] ?? {};
        const factoryDisplay = r.base.display ?? 'text';
        const merged: TableColumnOverride = { ...cur };
        if (mode === factoryDisplay) delete merged.display;
        else merged.display = mode;
        if (Object.keys(merged).length === 0) delete next[r.base.id];
        else next[r.base.id] = merged;
      }
      return { ...s, columnOverrides: next };
    });
  };

  const setAllKind = (kind: ColumnKind) => {
    setState((s) => {
      const next = { ...(s.columnOverrides ?? {}) };
      for (const r of rows) {
        const cur = next[r.base.id] ?? {};
        const factoryKind = r.base.kind ?? 'string';
        const merged: TableColumnOverride = { ...cur };
        if (kind === factoryKind) delete merged.kind;
        else merged.kind = kind;
        // Reset the aggregate method when kind changes (not all method
        // ids are valid for every kind).
        if (merged.kind !== r.kind) delete merged.aggregateMethod;
        if (Object.keys(merged).length === 0) delete next[r.base.id];
        else next[r.base.id] = merged;
      }
      return { ...s, columnOverrides: next };
    });
  };

  const setAllPalette = (paletteId: string) => {
    setState((s) => {
      const next = { ...(s.columnOverrides ?? {}) };
      for (const r of rows) {
        if (r.kind !== 'number') continue;
        const cur = next[r.base.id] ?? {};
        const merged: TableColumnOverride = { ...cur, palette: paletteId };
        // If the chosen palette equals the factory column's `palette`,
        // drop the override so URL state stays minimal.
        if (paletteId === r.base.palette) delete merged.palette;
        if (Object.keys(merged).length === 0) delete next[r.base.id];
        else next[r.base.id] = merged;
      }
      return { ...s, columnOverrides: next };
    });
  };

  const setAllSearchable = (searchable: boolean) => {
    setState((s) => {
      const next = { ...(s.columnOverrides ?? {}) };
      for (const r of rows) {
        // Only string columns can be search sources — text-bearing only.
        if (r.kind !== 'string') continue;
        const cur = next[r.base.id] ?? {};
        const factoryDefault = r.base.searchable ?? false;
        const merged: TableColumnOverride = { ...cur };
        if (searchable === factoryDefault) delete merged.searchable;
        else merged.searchable = searchable;
        if (Object.keys(merged).length === 0) delete next[r.base.id];
        else next[r.base.id] = merged;
      }
      return { ...s, columnOverrides: next };
    });
  };

  const resetAll = () => {
    setState((s) => ({
      ...s,
      columnOverrides: undefined,
      columnOrder: undefined,
    }));
  };

  // Counts to show "set all" affordances even when the per-column rows
  // disagree (e.g. button shows the majority and click flips everyone).
  const visibleCount = rows.filter((r) => !r.hidden).length;
  const heatmapEligible = rows.filter((r) =>
    DISPLAY_MODES.find((m) => m.id === 'heatmap')?.supports.includes(r.kind),
  );
  const allHeatmapOn =
    heatmapEligible.length > 0 &&
    heatmapEligible.every((r) => r.display === 'heatmap');
  const searchEligible = rows.filter((r) => r.kind === 'string');
  const allSearchOn =
    searchEligible.length > 0 && searchEligible.every((r) => r.searchable);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title="Configure columns"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 6px',
          borderRadius: 3,
          border: '1px solid var(--tbrowse-border)',
          background: open ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
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
              className="tbrowse-table-config"
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
                padding: 8,
                zIndex: 2000,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '70vh',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <strong>Column configuration</strong>
                <button
                  type="button"
                  onClick={resetAll}
                  style={popoverButtonStyle()}
                  title="Restore factory defaults for every column"
                >
                  Reset
                </button>
              </div>
              <div
                style={{
                  overflow: 'auto',
                  flex: '1 1 auto',
                  minHeight: 0,
                }}
              >
              <table
                style={{
                  borderCollapse: 'collapse',
                  tableLayout: 'auto',
                  fontSize: 11,
                }}
              >
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Visible</Th>
                    <Th>Label</Th>
                    <Th>Kind</Th>
                    <Th>Display</Th>
                    <Th>Palette</Th>
                    <Th>Aggregation</Th>
                    <Th>Searchable</Th>
                  </tr>
                  <tr style={{ background: 'var(--tbrowse-bg-alt)' }}>
                    <Td>
                      <span style={{ color: 'var(--tbrowse-text-subtle)', fontSize: 10 }}>
                        all
                      </span>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        style={popoverButtonStyle()}
                        onClick={() => setAllVisible(visibleCount !== rows.length)}
                        title={
                          visibleCount === rows.length
                            ? 'Hide all columns'
                            : 'Show all columns'
                        }
                      >
                        {visibleCount === rows.length ? 'hide all' : 'show all'}
                      </button>
                    </Td>
                    <Td />
                    <Td>
                      <select
                        value=""
                        onChange={(e) =>
                          e.target.value && setAllKind(e.target.value as ColumnKind)
                        }
                        style={selectStyle()}
                      >
                        <option value="">— set all —</option>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        style={popoverButtonStyle()}
                        onClick={() => setAllDisplay(allHeatmapOn ? 'text' : 'heatmap')}
                        disabled={heatmapEligible.length === 0}
                        title={
                          heatmapEligible.length === 0
                            ? 'No numeric columns'
                            : allHeatmapOn
                              ? 'Switch every numeric column back to text'
                              : 'Switch every numeric column to heatmap'
                        }
                      >
                        {allHeatmapOn ? 'all → text' : 'numeric → heatmap'}
                      </button>
                    </Td>
                    <Td>
                      <select
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          setAllPalette(e.target.value);
                        }}
                        style={selectStyle()}
                        title="Apply this palette to every numeric column"
                      >
                        <option value="">— set all —</option>
                        <optgroup label="Sequential">
                          {PALETTES.filter((p) => p.kind === 'sequential').map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Diverging">
                          {PALETTES.filter((p) => p.kind === 'diverging').map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </Td>
                    <Td />
                    <Td>
                      <button
                        type="button"
                        style={popoverButtonStyle()}
                        onClick={() => setAllSearchable(!allSearchOn)}
                        disabled={searchEligible.length === 0}
                        title={
                          searchEligible.length === 0
                            ? 'No text columns'
                            : allSearchOn
                              ? 'Stop searching every text column'
                              : 'Make every text column searchable'
                        }
                      >
                        {allSearchOn ? 'text → off' : 'text → on'}
                      </button>
                    </Td>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.base.id}>
                      <Td>
                        <span style={{ display: 'inline-flex', gap: 2 }}>
                          <button
                            type="button"
                            style={popoverIconButtonStyle()}
                            disabled={idx === 0}
                            onClick={() => moveColumn(r.base.id, -1)}
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            style={popoverIconButtonStyle()}
                            disabled={idx === rows.length - 1}
                            onClick={() => moveColumn(r.base.id, 1)}
                            title="Move down"
                          >
                            ↓
                          </button>
                        </span>
                      </Td>
                      <Td>
                        <input
                          type="checkbox"
                          checked={!r.hidden}
                          onChange={(e) =>
                            updateOverride(r.base.id, {
                              hidden: e.target.checked ? undefined : true,
                            })
                          }
                        />
                      </Td>
                      <Td>
                        <input
                          type="text"
                          value={r.label}
                          onChange={(e) =>
                            updateOverride(r.base.id, {
                              label:
                                e.target.value === r.base.label
                                  ? undefined
                                  : e.target.value,
                            })
                          }
                          style={textInputStyle()}
                        />
                      </Td>
                      <Td>
                        <select
                          value={r.kind}
                          onChange={(e) => {
                            const next = e.target.value as ColumnKind;
                            updateOverride(r.base.id, (prev) => ({
                              ...prev,
                              kind: next === (r.base.kind ?? 'string') ? undefined : next,
                              // Method ids are kind-scoped; clear when kind changes.
                              aggregateMethod: undefined,
                              // If display is no longer supported by the new kind, clear it.
                              display:
                                prev.display &&
                                !DISPLAY_MODES.find((m) => m.id === prev.display)?.supports.includes(next)
                                  ? undefined
                                  : prev.display,
                            }));
                          }}
                          style={selectStyle()}
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <select
                          value={r.display}
                          onChange={(e) => {
                            const next = e.target.value as TableDisplayMode;
                            updateOverride(r.base.id, {
                              display: next === (r.base.display ?? 'text') ? undefined : next,
                            });
                          }}
                          style={selectStyle()}
                        >
                          {DISPLAY_MODES.map((m) => (
                            <option
                              key={m.id}
                              value={m.id}
                              disabled={!m.supports.includes(r.kind)}
                            >
                              {m.label}
                              {!m.supports.includes(r.kind) ? ' (n/a)' : ''}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        {r.kind !== 'number' || !r.palette ? (
                          <span
                            style={{ fontSize: 11, color: 'var(--tbrowse-text-subtle)' }}
                            title="Palette applies to numeric heatmap columns only"
                          >
                            —
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <select
                              value={r.palette.id}
                              onChange={(e) => {
                                const next = e.target.value;
                                updateOverride(r.base.id, {
                                  palette: next === r.base.palette ? undefined : next,
                                });
                              }}
                              style={selectStyle()}
                              disabled={r.display !== 'heatmap'}
                              title={
                                r.display === 'heatmap'
                                  ? 'Pick a heatmap palette'
                                  : 'Switch this column to Heatmap to choose a palette'
                              }
                            >
                              <optgroup label="Sequential">
                                {PALETTES.filter((p) => p.kind === 'sequential').map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.label}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Diverging">
                                {PALETTES.filter((p) => p.kind === 'diverging').map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.label}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            {r.palette.kind === 'diverging' && (
                              <input
                                type="number"
                                value={r.paletteMidpoint}
                                step="any"
                                onChange={(e) => {
                                  const num = e.target.value === ''
                                    ? undefined
                                    : Number(e.target.value);
                                  const factoryMid = r.base.paletteMidpoint ?? 0;
                                  updateOverride(r.base.id, {
                                    paletteMidpoint:
                                      num === undefined || num === factoryMid
                                        ? undefined
                                        : num,
                                  });
                                }}
                                style={{
                                  ...textInputStyle(),
                                  width: 56,
                                  minWidth: 0,
                                }}
                                disabled={r.display !== 'heatmap'}
                                title={
                                  r.domain
                                    ? `Diverging midpoint (data range ${r.domain.min} – ${r.domain.max})`
                                    : 'Diverging midpoint (anchors the central palette stop)'
                                }
                              />
                            )}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {r.aggregateLocked ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--tbrowse-text-subtle)',
                            }}
                            title="Locked by zone factory"
                          >
                            (custom)
                          </span>
                        ) : (
                          <select
                            value={r.aggregateMethodId}
                            onChange={(e) =>
                              updateOverride(r.base.id, {
                                aggregateMethod: e.target.value || undefined,
                              })
                            }
                            style={selectStyle()}
                          >
                            {AGGREGATE_METHODS[r.kind].map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </Td>
                      <Td>
                        <input
                          type="checkbox"
                          checked={r.searchable}
                          disabled={r.kind !== 'string'}
                          title={
                            r.kind === 'string'
                              ? 'Add this column to the search-bar dropdown'
                              : 'Searchable supports text columns only'
                          }
                          onChange={(e) =>
                            updateOverride(r.base.id, {
                              searchable:
                                e.target.checked === (r.base.searchable ?? false)
                                  ? undefined
                                  : e.target.checked,
                            })
                          }
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: 'var(--tbrowse-text-subtle)',
        fontWeight: 600,
        padding: '3px 4px',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--tbrowse-border-soft)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return (
    <td
      style={{
        padding: '2px 4px',
        borderBottom: '1px solid var(--tbrowse-border-soft)',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

function popoverButtonStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    border: '1px solid var(--tbrowse-border)',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

function popoverIconButtonStyle(): React.CSSProperties {
  return {
    ...popoverButtonStyle(),
    padding: '0 4px',
    minWidth: 18,
  };
}

function selectStyle(): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '1px 2px',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    border: '1px solid var(--tbrowse-border)',
    borderRadius: 3,
    maxWidth: 130,
  };
}

function textInputStyle(): React.CSSProperties {
  return {
    fontSize: 11,
    padding: '1px 4px',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    border: '1px solid var(--tbrowse-border)',
    borderRadius: 3,
    width: 90,
    minWidth: 60,
  };
}
