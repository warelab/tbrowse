import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { SearchControls } from './SearchBar';
import { ZoneToggles } from './ChromeStrip';
import { TBrowseLogo } from '../icons/TBrowseLogo';
import { useTBrowseStore, DEFAULT_FONT_SIZE } from '../store';
import { LEAF_ROW_HEIGHT } from '../visibleRows';
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
  /** Initial open state of each disclosure section. Defaults: search
   *  follows `hasActiveSearch`, zones is closed. See
   *  `TBrowseProps.defaultOpenSections`. */
  defaultOpenSections?: { search?: boolean; zones?: boolean; display?: boolean };
  /** Per-zone load status — forwarded from `TBrowseProps.zoneStatus`. */
  zoneStatus?: Record<string, 'loading' | 'error' | 'ready'>;
  /** Host controls rendered right-aligned in the toolbar. */
  headerActions?: ReactNode;
  /** Show the Display section (row-height / font-size sliders). */
  densityControls?: boolean;
  /** Initial row height / font size, used as slider fallbacks when the
   *  corresponding `ViewState` field is unset. */
  rowHeight?: number;
  fontSize?: number;
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
  defaultOpenSections,
  zoneStatus,
  headerActions,
  densityControls,
  rowHeight,
  fontSize,
  containerRef,
}: ToolbarProps) {
  const hasActiveSearch = !!search?.query;
  // The host can pre-open each section; if unspecified, fall back to the
  // existing behaviour (search auto-opens when there's a query; zones
  // starts closed). The `useEffect` below still auto-opens search when a
  // controlled-host viewState change adds a query later, regardless of
  // the initial value picked here.
  const [searchOpen, setSearchOpen] = useState(
    defaultOpenSections?.search ?? hasActiveSearch,
  );
  const [zonesOpen, setZonesOpen] = useState(
    defaultOpenSections?.zones ?? false,
  );
  const [displayOpen, setDisplayOpen] = useState(
    defaultOpenSections?.display ?? false,
  );
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
      <ToolbarBrand />
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
        <ZoneToggles zones={zones} data={data} zoneStatus={zoneStatus} />
      </Section>
      {densityControls && (
        <Section
          id="tbrowse-toolbar-display"
          label="Display"
          open={displayOpen}
          onToggle={() => setDisplayOpen((o) => !o)}
        >
          <DisplayControls rowHeightProp={rowHeight} fontSizeProp={fontSize} />
        </Section>
      )}
      {headerActions && (
        <div
          className="tbrowse-toolbar-actions"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
          }}
        >
          {headerActions}
        </div>
      )}
    </div>
  );
}

/**
 * Row-height + font-size sliders, mirroring the playground's density
 * controls. They write `ViewState.rowHeight` / `ViewState.fontSize` via
 * `setViewState`, so the chosen density flows through the same
 * controlled/persisted view-state path as everything else. Current values
 * fall back to the `rowHeight` / `fontSize` props (then the built-in
 * defaults) when the view state hasn't set them yet.
 */
function DisplayControls({
  rowHeightProp,
  fontSizeProp,
}: {
  rowHeightProp?: number;
  fontSizeProp?: number;
}) {
  const rowHeightVS = useTBrowseStore((s) => s.viewState.rowHeight);
  const fontSizeVS = useTBrowseStore((s) => s.viewState.fontSize);
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const rowHeight = rowHeightVS ?? rowHeightProp ?? LEAF_ROW_HEIGHT;
  const fontSize = fontSizeVS ?? fontSizeProp ?? DEFAULT_FONT_SIZE;

  const labelStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    color: 'var(--tbrowse-text-muted)',
    fontSize: 11,
    whiteSpace: 'nowrap',
  };
  const valStyle: React.CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--tbrowse-text)',
    minWidth: 30,
    textAlign: 'right',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label style={labelStyle} title={`Row height: ${rowHeight}px`}>
        Row
        <input
          type="range"
          min={12}
          max={48}
          step={1}
          value={rowHeight}
          onChange={(e) => {
            const v = +e.target.value;
            setViewState((vs) => ({ ...vs, rowHeight: v }));
          }}
          style={{ verticalAlign: 'middle', width: 84 }}
        />
        <span style={valStyle}>{rowHeight}px</span>
      </label>
      <label style={labelStyle} title={`Font size: ${fontSize}px`}>
        Font
        <input
          type="range"
          min={8}
          max={20}
          step={1}
          value={fontSize}
          onChange={(e) => {
            const v = +e.target.value;
            setViewState((vs) => ({ ...vs, fontSize: v }));
          }}
          style={{ verticalAlign: 'middle', width: 84 }}
        />
        <span style={valStyle}>{fontSize}px</span>
      </label>
    </div>
  );
}

/**
 * Top-left wordmark — Clustal-coloured "TBrowse" rendered inline as
 * SVG so it stays crisp at any DPI and ships with the bundle. Picks
 * the dark or light palette to match the chassis's active theme.
 * Wrapped in a link to tbrowse.org so users can click through to
 * project home.
 */
function ToolbarBrand() {
  const theme = useTBrowseStore((s) => s.theme);
  return (
    <a
      className="tbrowse-toolbar-logo"
      href="https://tbrowse.org"
      target="_blank"
      rel="noopener noreferrer"
      title="TBrowse — open tbrowse.org"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 12px',
        borderRight: '1px solid var(--tbrowse-divider)',
        userSelect: 'none',
        textDecoration: 'none',
      }}
    >
      <TBrowseLogo height={24} variant={theme} />
    </a>
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
