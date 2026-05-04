import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { SearchControls } from './SearchBar';
import { ZoneToggles } from './ChromeStrip';
import type { SearchField } from '../search/fields';
import type {
  HostData,
  SearchResults,
  SearchState,
  ZoneDefinition,
} from '../types';

interface ToolbarProps {
  /** Zone definitions and host data — passed through to ZoneToggles. */
  zones: ZoneDefinition[];
  data: HostData;
  /** Search state slice; null when no search is in effect. */
  search: SearchState | null;
  setSearch: (next: SearchState | null) => void;
  searchResults: SearchResults;
  searchFields: ReadonlyArray<SearchField>;
  onCollapseToMatches: () => void;
  /** Hotkey opt-out — see `TBrowseProps.hotkeys`. */
  hotkeys?: { search?: boolean };
  /** Ref to the chassis-root element so the global keydown listener
   *  can gate on "user is interacting with our chassis" rather than
   *  greedily stealing every `/` keypress on the page. */
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Single-row toolbar with the TBrowse logo on the left followed by
 * two expandable section containers — `Search` and `Zones`. Each
 * section is an outlined div whose first child is a clickable
 * label; clicking the label toggles the section's controls in or
 * out via the CSS-grid `0fr ↔ 1fr` slide trick.
 *
 * Open state is local UI (not persisted in `ViewState`): the panels
 * are session affordances, not part of the data model. The search
 * panel auto-opens when an active query exists (so the user always
 * sees their query) and when the global hotkey fires.
 *
 * Hotkey scoping: `/` and Cmd/Ctrl-F only fire while the user is
 * interacting with the chassis — i.e. the cursor is over the
 * chassis root, OR keyboard focus is currently inside it. That
 * keeps host-app `/` listeners outside the chassis undisturbed.
 * Hosts can opt out entirely via `hotkeys.search = false`; the
 * search panel can still be opened programmatically by writing
 * to `ViewState.search`.
 */
export function Toolbar({
  zones,
  data,
  search,
  setSearch,
  searchResults,
  searchFields,
  onCollapseToMatches,
  hotkeys,
  containerRef,
}: ToolbarProps) {
  const hasActiveSearch = !!search?.query;
  const [searchOpen, setSearchOpen] = useState(hasActiveSearch);
  const [zonesOpen, setZonesOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHotkey = hotkeys?.search ?? true;

  // Reflect "search became active" into the open panel — so a
  // controlled-host viewState change that adds a query auto-shows
  // the panel. We don't auto-close on query clear; user might be
  // typing a new query.
  useEffect(() => {
    if (hasActiveSearch && !searchOpen) setSearchOpen(true);
  }, [hasActiveSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chassis-scoped focus hotkey. The listener still attaches at the
  // document level (because `/` keypresses with focus on `<body>`
  // don't bubble through anything else), but it only ACTS when the
  // user is engaging with the chassis: cursor hovering over us, or
  // keyboard focus inside us. Outside that scope the keypress is
  // left alone so host-app `/` shortcuts can do their thing. Hosts
  // can disable this entirely via `hotkeys.search = false`.
  useEffect(() => {
    if (!searchHotkey) return;
    const root = containerRef.current;
    if (!root) return;

    let cursorInside = false;
    const onEnter = () => {
      cursorInside = true;
    };
    const onLeave = () => {
      cursorInside = false;
    };
    root.addEventListener('mouseenter', onEnter);
    root.addEventListener('mouseleave', onLeave);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inEditable) return;

      // Gate: cursor over chassis, OR active element inside chassis.
      // If neither, the user is engaging with something else on the
      // page — let their hotkey listener (or browser default) win.
      const active = document.activeElement;
      const focusInside = active instanceof Node && root.contains(active);
      if (!cursorInside && !focusInside) return;

      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'f')) {
        e.preventDefault();
        setSearchOpen(true);
        // requestAnimationFrame keeps the focus inside the same
        // user-input event loop turn so browsers (Safari) don't
        // squash it.
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      root.removeEventListener('mouseenter', onEnter);
      root.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('keydown', onKey);
    };
  }, [containerRef, searchHotkey]);

  return (
    <div
      className="tbrowse-toolbar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 32,
        flexShrink: 0,
        borderBottom: '1px solid var(--tbrowse-divider)',
        background: 'var(--tbrowse-bg-strip)',
        color: 'var(--tbrowse-text)',
        fontSize: 12,
      }}
    >
      <TBrowseLogo />
      <Section
        id="tbrowse-toolbar-search"
        label="Search"
        open={searchOpen}
        onToggle={() => setSearchOpen((o) => !o)}
        // A small dot beside the label when there's an active query
        // but the panel is closed — prevents "where did my search
        // go?". Hidden when the panel is open (the controls are
        // already on screen).
        showDot={!searchOpen && hasActiveSearch}
      >
        <SearchControls
          search={search}
          setSearch={setSearch}
          results={searchResults}
          fields={searchFields}
          onCollapseToMatches={onCollapseToMatches}
          inputRef={searchInputRef}
          // Portal the gear popover into the chassis root rather
          // than `document.body` so it stays visible when the host
          // wraps TBrowse in a fullscreen modal (gramene-search /
          // sorghum-webapp homology view, etc.).
          portalTarget={containerRef}
        />
      </Section>
      <Section
        id="tbrowse-toolbar-zones"
        label="Zones"
        open={zonesOpen}
        onToggle={() => setZonesOpen((o) => !o)}
      >
        <ZoneToggles zones={zones} data={data} />
      </Section>
    </div>
  );
}

/**
 * Small phylogenetic-tree mark next to the wordmark. Inline SVG so
 * the icon picks up the active accent colour and stays sharp at
 * any DPI. The four leaf dots double as a visual hint for the
 * row-aligned data-zone metaphor TBrowse uses throughout.
 */
function TBrowseLogo() {
  const stroke = 'var(--tbrowse-accent)';
  return (
    <div
      className="tbrowse-toolbar-logo"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 12px',
        borderRight: '1px solid var(--tbrowse-divider)',
        userSelect: 'none',
      }}
      aria-label="TBrowse"
    >
      <svg
        width={22}
        height={16}
        viewBox="0 0 22 16"
        aria-hidden="true"
        fill="none"
      >
        <g stroke={stroke} strokeWidth={1.25} strokeLinecap="round">
          {/* root stem */}
          <line x1={1} y1={8} x2={4} y2={8} />
          {/* first split */}
          <line x1={4} y1={3} x2={4} y2={13} />
          {/* upper / lower halves */}
          <line x1={4} y1={3} x2={8} y2={3} />
          <line x1={4} y1={13} x2={8} y2={13} />
          {/* second-level splits */}
          <line x1={8} y1={1} x2={8} y2={5} />
          <line x1={8} y1={11} x2={8} y2={15} />
          {/* leaf branches */}
          <line x1={8} y1={1} x2={18} y2={1} />
          <line x1={8} y1={5} x2={18} y2={5} />
          <line x1={8} y1={11} x2={18} y2={11} />
          <line x1={8} y1={15} x2={18} y2={15} />
        </g>
        <g fill={stroke}>
          <circle cx={18.5} cy={1} r={1.5} />
          <circle cx={18.5} cy={5} r={1.5} />
          <circle cx={18.5} cy={11} r={1.5} />
          <circle cx={18.5} cy={15} r={1.5} />
        </g>
      </svg>
      <span
        style={{
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: 0.2,
          color: 'var(--tbrowse-text)',
        }}
      >
        TBrowse
      </span>
    </div>
  );
}

/**
 * Full-height toolbar section: a clickable text label and the
 * sliding controls panel that opens to its right, separated from
 * the next section by a vertical divider on its right edge. The
 * label has no button chrome — it reads as a section heading;
 * colour shifts from muted (closed) to accent-strong (open) so the
 * active section is unambiguous without any extra glyph.
 */
function Section({
  id,
  label,
  open,
  onToggle,
  showDot,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  showDot?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="tbrowse-toolbar-section"
      data-open={open}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '100%',
        // Vertical separator at the right edge of every section.
        borderRight: '1px solid var(--tbrowse-divider)',
      }}
    >
      <button
        type="button"
        className="tbrowse-toolbar-section-label"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: '100%',
          padding: '0 12px',
          background: 'transparent',
          border: 'none',
          color: open
            ? 'var(--tbrowse-accent-strong)'
            : 'var(--tbrowse-text-muted)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'color 180ms ease',
        }}
      >
        {label}
        {showDot && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: 3,
              background: 'var(--tbrowse-search)',
            }}
          />
        )}
      </button>
      <SlidingPanel id={id} open={open}>
        <div
          // Inline padding so the controls don't butt right up
          // against the label or the trailing divider.
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            paddingRight: 12,
          }}
        >
          {children}
        </div>
      </SlidingPanel>
    </div>
  );
}

/**
 * Sliding inline panel — uses the modern CSS-grid `0fr ↔ 1fr` trick
 * so the panel animates smoothly between collapsed and its content's
 * intrinsic width, no JS measurement required. The `display: grid`
 * wrapper holds a single `1fr` column that the inner div fills; the
 * inner div has `overflow: hidden` so the children get clipped
 * during the transition rather than wrapping awkwardly.
 */
function SlidingPanel({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="region"
      aria-hidden={!open}
      style={{
        display: 'grid',
        gridTemplateColumns: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition:
          'grid-template-columns 220ms ease, opacity 180ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div style={{ overflow: 'hidden', minWidth: 0 }}>{children}</div>
    </div>
  );
}
