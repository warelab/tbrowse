import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTBrowseStore } from '../store';
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
/**
 * Search controls — the inputs, toggles, and result UI. Returned
 * without an outer row wrapper so the parent toolbar can position
 * them inside a sliding panel. The external `inputRef` lets the
 * toolbar focus the input when the user opens the search panel via
 * a hotkey.
 */
export function SearchControls({
  search,
  setSearch,
  results,
  fields,
  onCollapseToMatches,
  inputRef: externalInputRef,
}: SearchBarProps & { inputRef?: RefObject<HTMLInputElement> }) {
  // Use the external ref if the toolbar passed one (so hotkeys can
  // focus the input even when the controls aren't mounted in the
  // same component as the hotkey listener), otherwise fall back to
  // a local ref.
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const [fieldPopoverOpen, setFieldPopoverOpen] = useState(false);

  const query = search?.query ?? '';
  const caseSensitive = search?.caseSensitive ?? false;
  const regex = search?.regex ?? false;
  const excluded = new Set(search?.excludedFields ?? []);
  const activeFieldCount = fields.length - excluded.size;
  // Any non-default config — drives the gear icon's active styling so
  // the user can tell at a glance the search has been customised.
  const hasNonDefaultConfig =
    caseSensitive ||
    regex ||
    excluded.size > 0;

  const update = (patch: Partial<SearchState>) => {
    const nextQuery = patch.query ?? query;
    const nextCS = patch.caseSensitive ?? caseSensitive;
    const nextRe = patch.regex ?? regex;
    const nextExcluded = patch.excludedFields ?? search?.excludedFields ?? [];
    // Only collapse to null when EVERYTHING is default — empty
    // query AND no excluded fields AND both modifiers off. The
    // popover lets the user configure fields and modifiers before
    // typing a query; if we cleared on empty query alone, those
    // configuration changes would no-op silently because there's
    // nothing to preserve them in.
    const hasNonDefault =
      nextCS || nextRe || nextExcluded.length > 0;
    if (!nextQuery && !hasNonDefault) {
      setSearch(null);
      return;
    }
    const next: SearchState = {
      query: nextQuery,
      ...(nextExcluded.length > 0 ? { excludedFields: nextExcluded } : {}),
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
      className="tbrowse-search-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--tbrowse-text)',
      }}
    >
      {/* 1 — query input */}
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
      {/* 2 — match count (or regex error) */}
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
      {/* 3 — show matches only (only when there's a non-zero hit set) */}
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
      {/* 4 — clear search */}
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
      {/* 5 — gear: opens a single popover with the field selector
          and the case-sensitive / regex modifiers */}
      <ConfigPopoverButton
        fields={fields}
        excluded={excluded}
        activeFieldCount={activeFieldCount}
        totalFieldCount={fields.length}
        caseSensitive={caseSensitive}
        regex={regex}
        nonDefault={hasNonDefaultConfig}
        open={fieldPopoverOpen}
        setOpen={setFieldPopoverOpen}
        onToggleField={toggleField}
        onSelectAllFields={() => update({ excludedFields: [] })}
        onSelectNoFields={() =>
          update({ excludedFields: fields.map((f) => f.id) })
        }
        onToggleCaseSensitive={() =>
          update({ caseSensitive: !caseSensitive })
        }
        onToggleRegex={() => update({ regex: !regex })}
      />
    </div>
  );
}

interface ConfigPopoverButtonProps {
  fields: ReadonlyArray<SearchField>;
  excluded: Set<string>;
  activeFieldCount: number;
  totalFieldCount: number;
  caseSensitive: boolean;
  regex: boolean;
  /** True when any field is excluded, or either modifier is on —
   *  drives the gear icon's accent treatment so the user can tell
   *  the search is non-default at a glance. */
  nonDefault: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onToggleField: (id: string) => void;
  onSelectAllFields: () => void;
  onSelectNoFields: () => void;
  onToggleCaseSensitive: () => void;
  onToggleRegex: () => void;
}

/**
 * Single popover that consolidates every search configuration knob
 * behind one gear icon: which fields to search across, plus the
 * case-sensitive / regex modifiers. Replaces what used to be a
 * `Fields ▾` dropdown plus two inline toggle buttons; collapsing
 * them into a single popover keeps the row compact.
 *
 * The trigger picks up an accent treatment whenever any
 * non-default config is active (`nonDefault`), so the user can
 * tell at a glance that the search has been customised even when
 * the popover is closed. Switches to the danger colour if the
 * user has unticked every field — search is effectively
 * disabled until they re-enable at least one.
 */
function ConfigPopoverButton({
  fields,
  excluded,
  activeFieldCount,
  totalFieldCount,
  caseSensitive,
  regex,
  nonDefault,
  open,
  setOpen,
  onToggleField,
  onSelectAllFields,
  onSelectNoFields,
  onToggleCaseSensitive,
  onToggleRegex,
}: ConfigPopoverButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const allFieldsOff = activeFieldCount === 0;
  // The portaled popover renders into <body>, OUTSIDE the chassis
  // root that carries the `tbrowse-theme-*` class — so the CSS
  // custom properties (--tbrowse-bg-elevated etc.) wouldn't resolve
  // and the popover would render with a transparent background. We
  // wrap the portaled content in a themed div so the same vars
  // resolve on this side of the portal.
  const theme = useTBrowseStore((s) => s.theme);

  // The popover is portaled into <body> so the SlidingPanel's
  // `overflow: hidden` (needed for the slide animation) doesn't
  // clip it below the toolbar row. We compute its viewport-fixed
  // anchor from the gear button's bounding rect — top edge sits
  // 4px below the button, right edge aligned with the button's
  // right edge. Recomputed on every open transition.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, [open]);

  // Close on outside click + Escape. The popover lives outside the
  // wrapRef subtree (it's portaled into <body>), so the
  // outside-click test has to consider both regions.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Re-anchor on resize so the popover stays under the gear if
    // the chassis width changes while open. Scroll-handling is
    // intentionally omitted: the toolbar doesn't scroll within
    // the chassis, and host-page scroll is rare enough that we'd
    // rather keep the popover stationary than fight with it.
    const onResize = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      }
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
      window.addEventListener('resize', onResize);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, setOpen]);

  const popoverContent = open && pos && (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Search settings"
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        zIndex: 1000,
        minWidth: 240,
        padding: 6,
        background: 'var(--tbrowse-bg-elevated)',
        border: '1px solid var(--tbrowse-border)',
        borderRadius: 4,
        boxShadow: '0 4px 12px var(--tbrowse-tooltip-shadow)',
        color: 'var(--tbrowse-text)',
        fontSize: 12,
      }}
    >
      {/* Fields section */}
      <SectionHeader
        label="Fields"
        badge={
          activeFieldCount === totalFieldCount
            ? `${totalFieldCount}`
            : `${activeFieldCount}/${totalFieldCount}`
        }
        actions={
          <>
            <button
              type="button"
              onClick={onSelectAllFields}
              style={popoverLinkStyle}
            >
              All
            </button>
            <button
              type="button"
              onClick={onSelectNoFields}
              style={popoverLinkStyle}
            >
              None
            </button>
          </>
        }
      />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        {fields.map((f) => {
          const checked = !excluded.has(f.id);
          return (
            <li key={f.id}>
              <CheckboxRow
                checked={checked}
                onToggle={() => onToggleField(f.id)}
                label={f.label}
              />
            </li>
          );
        })}
      </ul>
      {/* Modifiers section */}
      <div
        style={{
          borderTop: '1px solid var(--tbrowse-border-soft)',
          marginTop: 4,
          paddingTop: 4,
        }}
      />
      <SectionHeader label="Modifiers" />
      <CheckboxRow
        checked={caseSensitive}
        onToggle={onToggleCaseSensitive}
        label="Case-sensitive"
        hint="Aa"
      />
      <CheckboxRow
        checked={regex}
        onToggle={onToggleRegex}
        label="Regular expression"
        hint=".*"
      />
    </div>
  );

  return (
    <div ref={wrapRef} style={{ display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Search settings"
        title={
          allFieldsOff
            ? 'No fields selected — search disabled. Click to configure.'
            : nonDefault
              ? 'Search settings (modified)'
              : 'Search settings'
        }
        onClick={() => setOpen(!open)}
        style={{
          height: 22,
          width: 26,
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: allFieldsOff
            ? 'transparent'
            : nonDefault
              ? 'var(--tbrowse-accent-soft)'
              : 'var(--tbrowse-bg-elevated)',
          color: allFieldsOff
            ? 'var(--tbrowse-danger)'
            : nonDefault
              ? 'var(--tbrowse-accent)'
              : 'var(--tbrowse-text-muted)',
          border: `1px solid ${
            allFieldsOff
              ? 'var(--tbrowse-danger)'
              : nonDefault
                ? 'var(--tbrowse-accent)'
                : 'var(--tbrowse-border)'
          }`,
          borderRadius: 3,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <GearIcon />
      </button>
      {popoverContent &&
        createPortal(
          // Themed wrapper re-applies the `tbrowse-theme-*` class
          // on this side of the portal so the popover's CSS
          // custom properties resolve and it gets a real
          // background instead of rendering transparent on top of
          // whatever sits beneath it.
          <div className={`tbrowse-root tbrowse-theme-${theme}`}>
            {popoverContent}
          </div>,
          document.body,
        )}
    </div>
  );
}

function SectionHeader({
  label,
  badge,
  actions,
}: {
  label: string;
  badge?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 6,
        padding: '4px 4px 2px 4px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: 'var(--tbrowse-text-muted)',
      }}
    >
      <span>
        {label}
        {badge && (
          <span
            style={{
              marginLeft: 6,
              fontWeight: 400,
              color: 'var(--tbrowse-text-subtle)',
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            {badge}
          </span>
        )}
      </span>
      {actions && <span style={{ display: 'flex', gap: 4 }}>{actions}</span>}
    </div>
  );
}

function CheckboxRow({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 4px',
        borderRadius: 3,
        cursor: 'pointer',
      }}
      // Don't let label-mousedown steal focus from the parent search
      // input; otherwise blur clears focus halfway through a click.
      onMouseDown={(e) => e.preventDefault()}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ flex: 1 }}>{label}</span>
      {hint && (
        <span
          aria-hidden="true"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 10,
            color: 'var(--tbrowse-text-subtle)',
            background: 'var(--tbrowse-bg-input)',
            border: '1px solid var(--tbrowse-border-soft)',
            borderRadius: 2,
            padding: '0 4px',
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

/** Inline gear/cog SVG. Two concentric outlines plus eight teeth;
 *  uses currentColor so it inherits the parent button's color
 *  (drives the active / inactive treatment). */
function GearIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
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
