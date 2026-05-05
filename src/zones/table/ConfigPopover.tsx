import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../../store';
import { AGGREGATE_METHODS, methodForKind } from './aggregators';
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
}

interface ConfigPopoverProps {
  factoryColumns: TableColumn[];
  state: TableZoneState;
  setState: (next: TableZoneState | ((prev: TableZoneState) => TableZoneState)) => void;
  /** Order ids in display order, used for the "move up/down" controls. */
  orderedIds: string[];
}

export function ConfigPopover({
  factoryColumns,
  state,
  setState,
  orderedIds,
}: ConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
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
      return {
        base,
        hidden: ov.hidden ?? false,
        label: ov.label ?? base.label,
        kind,
        display: safeDisplay,
        aggregateMethodId,
        aggregateLocked,
      };
    })
    .filter((r): r is EffectiveColumnRow => r !== null);

  const togglePopover = () => {
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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        title="Configure columns"
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 3,
          border: '1px solid var(--tbrowse-border)',
          background: open ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
          color: 'var(--tbrowse-text)',
          cursor: 'pointer',
        }}
      >
        ⚙ Configure
      </button>
      {open &&
        pos &&
        createPortal(
          <div className={`tbrowse-root tbrowse-theme-${theme}`}>
            <div
              className="tbrowse-table-config"
              style={{
                position: 'fixed',
                left: Math.max(8, pos.x),
                top: pos.y,
                background: 'var(--tbrowse-bg-elevated)',
                border: '1px solid var(--tbrowse-border)',
                color: 'var(--tbrowse-text)',
                borderRadius: 6,
                boxShadow: '0 4px 16px var(--tbrowse-tooltip-shadow)',
                padding: 10,
                zIndex: 1000,
                minWidth: 540,
                fontSize: 12,
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
              <table
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  tableLayout: 'auto',
                }}
              >
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Visible</Th>
                    <Th>Label</Th>
                    <Th>Kind</Th>
                    <Th>Display</Th>
                    <Th>Aggregation</Th>
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
                    <Td />
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
                    </tr>
                  ))}
                </tbody>
              </table>
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
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--tbrowse-text-subtle)',
        fontWeight: 600,
        padding: '4px 6px',
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
        padding: '4px 6px',
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
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 3,
    border: '1px solid var(--tbrowse-border)',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    cursor: 'pointer',
  };
}

function popoverIconButtonStyle(): React.CSSProperties {
  return {
    ...popoverButtonStyle(),
    padding: '0 6px',
    minWidth: 22,
  };
}

function selectStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '1px 4px',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    border: '1px solid var(--tbrowse-border)',
    borderRadius: 3,
  };
}

function textInputStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '2px 6px',
    background: 'var(--tbrowse-bg-input)',
    color: 'var(--tbrowse-text)',
    border: '1px solid var(--tbrowse-border)',
    borderRadius: 3,
    width: '100%',
    minWidth: 120,
  };
}
