import { useTBrowseStore } from '../store';
import type { HostData, ViewState, ZoneDefinition } from '../types';

interface ZoneTogglesProps {
  zones: ZoneDefinition[];
  data: HostData;
  /** Optional per-zone host-supplied load status. Drives the visual
   *  loading-pulse / error-tint without changing toggle behaviour. */
  zoneStatus?: Record<string, 'loading' | 'error' | 'ready'>;
}

/** Segmented-control wrapper: rounded outer corners + a single outer
 *  border, inner buttons flush. Mirrors the genome header's
 *  CDS|Gene|±2kb group so the two read as the same control. */
const segGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--tbrowse-border)',
  borderRadius: 3,
  overflow: 'hidden',
};

/** One item in the ordered render list: either a standalone zone toggle
 *  or a mutually-exclusive group rendered as a segmented control. */
type Slot =
  | { kind: 'single'; def: ZoneDefinition }
  | { kind: 'group'; id: string; members: ZoneDefinition[] };

/**
 * Per-zone visibility toggle buttons. Returned without an outer row
 * wrapper so the parent toolbar can position them inside a sliding
 * panel; renders one button per registered zone, lit when the zone
 * is currently visible.
 *
 * Zones that declare the same `exclusiveGroup` collapse into a single
 * segmented control. By default such a group is *linked*: turning one
 * member on turns its siblings off (clicking the lit member turns it
 * off, so "none" is reachable). The `multi` toggle beside the group
 * decouples it, after which the members behave as ordinary independent
 * toggles; re-linking keeps the first visible member and drops the rest.
 * The decoupled set lives in `ViewState.unlinkedZoneGroups`, so the
 * choice round-trips through persisted/shared views.
 *
 * If the host supplies a `zoneStatus` map, buttons reflect the load
 * state of the backing data: a 'loading' status applies a subtle
 * opacity pulse via the `tbrowse-zone-loading` class; an 'error'
 * status applies a red border + tinted background via
 * `tbrowse-zone-error` and disables interaction.
 */
export function ZoneToggles({ zones, data, zoneStatus }: ZoneTogglesProps) {
  const zoneStates = useTBrowseStore((s) => s.viewState.zones);
  const zoneSlots = useTBrowseStore((s) => s.viewState.zoneStates);
  const unlinkedGroups = useTBrowseStore(
    (s) => s.viewState.unlinkedZoneGroups,
  );
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const visibleById: Record<string, boolean> = {};
  for (const z of zoneStates) visibleById[z.id] = z.visible;
  const unlinked = new Set(unlinkedGroups ?? []);

  /** Apply a batch of visibility changes, appending entries for zones the
   *  view state doesn't know about yet. Everything touched is marked
   *  `userToggled` so auto-enable won't later override the choice. */
  const applyVisibility = (
    vs: ViewState,
    changes: Record<string, boolean>,
  ): ViewState => {
    let next = vs.zones.map((z) =>
      Object.prototype.hasOwnProperty.call(changes, z.id)
        ? { ...z, visible: changes[z.id], userToggled: true }
        : z,
    );
    for (const [id, visible] of Object.entries(changes)) {
      if (next.some((z) => z.id === id)) continue;
      const def = zones.find((d) => d.id === id);
      if (!def) continue;
      next = [
        ...next,
        { id, width: def.defaultWidth, visible, userToggled: true },
      ];
    }
    return { ...vs, zones: next };
  };

  const toggle = (zoneId: string, group?: Slot & { kind: 'group' }) => {
    setViewState((vs) => {
      const current = vs.zones.find((z) => z.id === zoneId)?.visible ?? false;
      const isExclusive =
        !!group && !(vs.unlinkedZoneGroups ?? []).includes(group.id);
      // Independent toggle: plain flip.
      if (!isExclusive) return applyVisibility(vs, { [zoneId]: !current });
      // Exclusive + already lit: turn it off (a group may show nothing).
      if (current) return applyVisibility(vs, { [zoneId]: false });
      // Exclusive: light this one, clear its siblings.
      const changes: Record<string, boolean> = {};
      for (const m of group.members) changes[m.id] = m.id === zoneId;
      return applyVisibility(vs, changes);
    });
  };

  const toggleLink = (group: Slot & { kind: 'group' }) => {
    setViewState((vs) => {
      const cur = vs.unlinkedZoneGroups ?? [];
      if (!cur.includes(group.id)) {
        return { ...vs, unlinkedZoneGroups: [...cur, group.id] };
      }
      // Re-linking: collapse to the first visible member so the group
      // lands back in a legal (at most one) state.
      const relinked: ViewState = {
        ...vs,
        unlinkedZoneGroups: cur.filter((g) => g !== group.id),
      };
      const visibleMembers = group.members.filter(
        (m) => vs.zones.find((z) => z.id === m.id)?.visible,
      );
      if (visibleMembers.length <= 1) return relinked;
      const changes: Record<string, boolean> = {};
      for (const m of visibleMembers) {
        changes[m.id] = m.id === visibleMembers[0].id;
      }
      return applyVisibility(relinked, changes);
    });
  };

  /** Per-zone load/availability state shared by both renderings. */
  const statusOf = (def: ZoneDefinition) => {
    const available = def.isAvailable(data);
    const status = zoneStatus?.[def.id];
    const isLoading = status === 'loading';
    const isError = status === 'error';
    const titleParts: string[] = [];
    if (isLoading) titleParts.push('Loading…');
    else if (isError) titleParts.push('Load failed — click to retry from the host');
    else if (!available) titleParts.push('Unavailable: required data missing');
    return {
      available,
      isLoading,
      isError,
      // While loading the button doesn't toggle (no data to show anyway).
      // On error it stays clickable so a previously-shown zone can be
      // collapsed/expanded, but it visibly flags the failed attempt.
      enabled: available && !isLoading,
      title: titleParts.join(' ') || undefined,
      className: [
        'tbrowse-zone-toggle',
        isLoading ? 'tbrowse-zone-loading' : '',
        isError ? 'tbrowse-zone-error' : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  };

  /** Each zone state may carry a user-set `name`; honour it so the toggle
   *  matches the live header label. Falls back to the factory name. */
  const labelOf = (def: ZoneDefinition) => {
    const slot = zoneSlots?.[def.id] as { name?: string } | undefined;
    return slot?.name && slot.name !== '' ? slot.name : def.displayName;
  };

  // Ordered render list: ungrouped zones stay in place; a group renders
  // once, at the position of its first member. A group with a single
  // registered member degrades to a plain toggle (a one-segment
  // segmented control would be noise).
  const slots: Slot[] = [];
  const seenGroups = new Set<string>();
  for (const def of zones) {
    const gid = def.exclusiveGroup;
    if (!gid) {
      slots.push({ kind: 'single', def });
      continue;
    }
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    const members = zones.filter((d) => d.exclusiveGroup === gid);
    if (members.length < 2) slots.push({ kind: 'single', def });
    else slots.push({ kind: 'group', id: gid, members });
  }

  return (
    <div
      className="tbrowse-zone-toggles"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--tbrowse-text)',
        flexWrap: 'wrap',
      }}
    >
      {slots.map((slot) => {
        if (slot.kind === 'single') {
          const def = slot.def;
          const visible = visibleById[def.id] ?? false;
          const st = statusOf(def);
          return (
            <button
              key={def.id}
              type="button"
              className={st.className}
              onClick={() => toggle(def.id)}
              disabled={!st.enabled}
              title={st.title}
              aria-pressed={visible}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                lineHeight: 1.4,
                borderRadius: 3,
                // Error state overrides the standard accent border via the
                // `tbrowse-zone-error` class (defined in theme.ts) so it
                // wins visually without inline-style fighting.
                border: `1px solid ${visible ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
                background: visible
                  ? 'var(--tbrowse-accent-soft)'
                  : 'var(--tbrowse-bg-input)',
                color: st.available
                  ? visible
                    ? 'var(--tbrowse-accent-strong)'
                    : 'var(--tbrowse-text)'
                  : 'var(--tbrowse-text-subtle)',
                cursor: st.enabled
                  ? 'pointer'
                  : st.isLoading
                    ? 'progress'
                    : 'not-allowed',
              }}
            >
              {labelOf(def)}
            </button>
          );
        }

        const isUnlinked = unlinked.has(slot.id);
        return (
          <span
            key={`group-${slot.id}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span
              style={segGroupStyle}
              role="group"
              aria-label={`${slot.id} zones`}
            >
              {slot.members.map((def, i) => {
                const visible = visibleById[def.id] ?? false;
                const st = statusOf(def);
                const isLast = i === slot.members.length - 1;
                return (
                  <button
                    key={def.id}
                    type="button"
                    className={st.className}
                    onClick={() => toggle(def.id, slot)}
                    disabled={!st.enabled}
                    title={st.title}
                    aria-pressed={visible}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      lineHeight: 1.4,
                      border: 'none',
                      borderRight: isLast
                        ? 'none'
                        : '1px solid var(--tbrowse-border)',
                      background: visible
                        ? 'var(--tbrowse-accent-soft)'
                        : 'var(--tbrowse-bg-input)',
                      color: st.available
                        ? visible
                          ? 'var(--tbrowse-accent-strong)'
                          : 'var(--tbrowse-text)'
                        : 'var(--tbrowse-text-subtle)',
                      cursor: st.enabled
                        ? 'pointer'
                        : st.isLoading
                          ? 'progress'
                          : 'not-allowed',
                      fontFamily: 'inherit',
                    }}
                  >
                    {labelOf(def)}
                  </button>
                );
              })}
            </span>
            <button
              type="button"
              onClick={() => toggleLink(slot)}
              aria-pressed={isUnlinked}
              title={
                isUnlinked
                  ? 'Multiple of these zones allowed — click to show only one at a time'
                  : 'Only one of these zones at a time — click to allow multiple'
              }
              style={{
                fontSize: 11,
                padding: '2px 6px',
                lineHeight: 1.4,
                borderRadius: 3,
                border: `1px solid ${isUnlinked ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
                background: isUnlinked
                  ? 'var(--tbrowse-accent-soft)'
                  : 'var(--tbrowse-bg-input)',
                color: isUnlinked
                  ? 'var(--tbrowse-accent-strong)'
                  : 'var(--tbrowse-text-muted)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              multi
            </button>
          </span>
        );
      })}
    </div>
  );
}
