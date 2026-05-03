import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SearchField } from '../search/fields';
import type { SearchResults, SearchState } from '../types';
import { SEARCH_MATCH_LIMIT } from '../types';

interface SearchBarProps {
  /** Active search slice; null when no search is in effect. */
  search: SearchState | null;
  /** Replace the active search slice (or pass null to clear). */
  setSearch: (next: SearchState | null) => void;
  /** Resolved match sets — drives the count and error display. */
  results: SearchResults;
  /** Field registry (built-ins + host extras). */
  fields: ReadonlyArray<SearchField>;
  /** One-shot action that collapses every internal node not on a
   *  match's root-path, leaving only the matched lineages visible. */
  onCollapseToMatches: () => void;
}

/**
 * Chassis-level search bar. Multi-field by default — every
 * registered `SearchField` is active and a leaf matches if its
 * value in ANY active field hits the query. The "Fields ▾" button
 * opens a checkbox popover where the user can opt fields out;
 * exclusions persist in `SearchState.excludedFields` and survive
 * URL round-trips.
 *
 * Behaviour:
 * - Typing updates `search.query`, which feeds the chassis-level
 *   resolution memo. There's no debounce — the resolver is fast
 *   enough at the 10k-leaf cap that per-keystroke recompute is
 *   imperceptible. Hosts that want debounced URL persistence can
 *   throttle their `onViewStateChange`.
 * - `/` (or Cmd/Ctrl-F) anywhere in the document focuses the input
 *   when no other text field is focused.
 * - `Escape` while focused clears the search slice (sets it to null).
 * - Regex compilation errors render inline; the input borders red.
 * - When matches are capped at `SEARCH_MATCH_LIMIT`, the count
 *   shows "first 10000 (more)". Hosts can refine the query to
 *   surface specific matches.
 */
export function SearchBar({
  search,
  setSearch,
  results,
  fields,
  onCollapseToMatches,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fieldPopoverOpen, setFieldPopoverOpen] = useState(false);

  // Global focus hotkey: `/` or Cmd/Ctrl-F outside any text input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inEditable) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'f')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const query = search?.query ?? '';
  const caseSensitive = search?.caseSensitive ?? false;
  const regex = search?.regex ?? false;
  const excluded = new Set(search?.excludedFields ?? []);
  const activeFieldCount = fields.length - excluded.size;

  const update = (patch: Partial<SearchState>) => {
    const nextQuery = patch.query ?? query;
    const nextCS = patch.caseSensitive ?? caseSensitive;
    const nextRe = patch.regex ?? regex;
    const nextExcluded = patch.excludedFields ?? search?.excludedFields;
    if (!nextQuery) {
      setSearch(null);
      return;
    }
    const next: SearchState = {
      query: nextQuery,
      ...(nextExcluded && nextExcluded.length > 0
        ? { excludedFields: nextExcluded }
        : {}),
      ...(nextCS ? { caseSensitive: true } : {}),
      ...(nextRe ? { regex: true } : {}),
    };
    setSearch(next);
  };

  const toggleField = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update({ excludedFields: [...next] });
  };

  const matchCount = results.matchedLeafIds.size;
  const hasError = !!results.regexError;
  const showCount = !!query;
  const showTruncated = results.truncated;

  return (
    <div
      className="tbrowse-searchbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        height: 30,
        borderBottom: '1px solid var(--tbrowse-border)',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <FieldsPopoverButton
        fields={fields}
        excluded={excluded}
        activeCount={activeFieldCount}
        totalCount={fields.length}
        open={fieldPopoverOpen}
        setOpen={setFieldPopoverOpen}
        onToggleField={toggleField}
        onSelectAll={() => update({ excludedFields: [] })}
        onSelectNone={() =>
          update({ excludedFields: fields.map((f) => f.id) })
        }
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          flex: '0 1 280px',
        }}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search…"
          onChange={(e) => update({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? 'tbrowse-search-error' : undefined}
          style={{
            width: '100%',
            height: 22,
            padding: '0 6px',
            background: 'var(--tbrowse-bg-elevated)',
            color: 'var(--tbrowse-text)',
            border: `1px solid ${hasError ? 'var(--tbrowse-danger)' : 'var(--tbrowse-border)'}`,
            borderRadius: 3,
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>
      <ToggleButton
        label="Aa"
        title="Case-sensitive"
        active={caseSensitive}
        onClick={() => update({ caseSensitive: !caseSensitive })}
      />
      <ToggleButton
        label=".*"
        title="Regular expression"
        active={regex}
        onClick={() => update({ regex: !regex })}
      />
      {showCount && (
        <span
          style={{
            color: hasError
              ? 'var(--tbrowse-danger)'
              : matchCount === 0
                ? 'var(--tbrowse-text-muted)'
                : 'var(--tbrowse-text)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {hasError ? (
            <span id="tbrowse-search-error" title={results.regexError ?? ''}>
              regex error
            </span>
          ) : (
            <>
              {matchCount.toLocaleString()}{' '}
              {matchCount === 1 ? 'match' : 'matches'}
              {showTruncated && (
                <span
                  title={`Capped at ${SEARCH_MATCH_LIMIT.toLocaleString()} — refine the query to find specific matches.`}
                  style={{
                    marginLeft: 4,
                    color: 'var(--tbrowse-text-muted)',
                  }}
                >
                  (more)
                </span>
              )}
            </>
          )}
        </span>
      )}
      {showCount && matchCount > 0 && (
        <button
          type="button"
          aria-label="Show matches only"
          onClick={onCollapseToMatches}
          title="Collapse every subtree that doesn't contain a match — only the matched lineages stay expanded."
          style={{
            height: 22,
            padding: '0 8px',
            background: 'var(--tbrowse-search-soft)',
            color: 'var(--tbrowse-search)',
            border: '1px solid var(--tbrowse-search)',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Show matches only
        </button>
      )}
      {showCount && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setSearch(null)}
          title="Clear search (Esc)"
          style={{
            height: 22,
            padding: '0 6px',
            background: 'transparent',
            color: 'var(--tbrowse-text-muted)',
            border: '1px solid var(--tbrowse-border)',
            borderRadius: 3,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function ToggleButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        height: 22,
        minWidth: 26,
        padding: '0 6px',
        background: active
          ? 'var(--tbrowse-accent-soft)'
          : 'var(--tbrowse-bg-elevated)',
        color: active ? 'var(--tbrowse-accent)' : 'var(--tbrowse-text-muted)',
        border: `1px solid ${active ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
        borderRadius: 3,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

interface FieldsPopoverButtonProps {
  fields: ReadonlyArray<SearchField>;
  excluded: Set<string>;
  activeCount: number;
  totalCount: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  onToggleField: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

function FieldsPopoverButton({
  fields,
  excluded,
  activeCount,
  totalCount,
  open,
  setOpen,
  onToggleField,
  onSelectAll,
  onSelectNone,
}: FieldsPopoverButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click. Set up only while open so we don't keep
  // a global listener for an off-screen popover. Deferred so the
  // open-click itself doesn't re-close the popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // Match-bar legend: badge the field count when partially active so
  // the user sees at a glance that some fields are off.
  const badge =
    activeCount === totalCount
      ? `Fields (${totalCount})`
      : `Fields (${activeCount}/${totalCount})`;
  const partial = activeCount !== totalCount && activeCount > 0;
  const allOff = activeCount === 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Search fields"
        title={
          allOff
            ? 'No fields selected — search disabled. Click to choose fields.'
            : `${activeCount} of ${totalCount} fields active`
        }
        onClick={() => setOpen(!open)}
        style={{
          height: 22,
          padding: '0 6px',
          background: partial
            ? 'var(--tbrowse-accent-soft)'
            : 'var(--tbrowse-bg-elevated)',
          color: allOff
            ? 'var(--tbrowse-danger)'
            : partial
              ? 'var(--tbrowse-accent)'
              : 'var(--tbrowse-text)',
          border: `1px solid ${
            allOff
              ? 'var(--tbrowse-danger)'
              : partial
                ? 'var(--tbrowse-accent)'
                : 'var(--tbrowse-border)'
          }`,
          borderRadius: 3,
          fontSize: 12,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {badge} ▾
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose search fields"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 1000,
            minWidth: 220,
            padding: 6,
            background: 'var(--tbrowse-bg-elevated)',
            border: '1px solid var(--tbrowse-border)',
            borderRadius: 4,
            boxShadow: '0 4px 12px var(--tbrowse-tooltip-shadow)',
            color: 'var(--tbrowse-text)',
            fontSize: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: '2px 4px 6px 4px',
              borderBottom: '1px solid var(--tbrowse-border-soft)',
              marginBottom: 4,
            }}
          >
            <button
              type="button"
              onClick={onSelectAll}
              style={popoverLinkStyle}
            >
              All
            </button>
            <button
              type="button"
              onClick={onSelectNone}
              style={popoverLinkStyle}
            >
              None
            </button>
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {fields.map((f) => {
              const checked = !excluded.has(f.id);
              return (
                <li key={f.id} style={{ padding: '2px 0' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 4px',
                      borderRadius: 3,
                      cursor: 'pointer',
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleField(f.id)}
                    />
                    <span>{f.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const popoverLinkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--tbrowse-accent)',
  fontSize: 11,
  cursor: 'pointer',
  padding: '2px 4px',
};
