import { useTBrowseStore } from '../store';
import type { HostData, ZoneDefinition } from '../types';

interface ZoneTogglesProps {
  zones: ZoneDefinition[];
  data: HostData;
  /** Optional per-zone host-supplied load status. Drives the visual
   *  loading-pulse / error-tint without changing toggle behaviour. */
  zoneStatus?: Record<string, 'loading' | 'error' | 'ready'>;
}

/**
 * Per-zone visibility toggle buttons. Returned without an outer row
 * wrapper so the parent toolbar can position them inside a sliding
 * panel; renders one button per registered zone, lit when the zone
 * is currently visible.
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
  const setViewState = useTBrowseStore((s) => s.setViewState);

  const visibleById: Record<string, boolean> = {};
  for (const z of zoneStates) visibleById[z.id] = z.visible;

  const toggle = (zoneId: string) => {
    setViewState((vs) => {
      const idx = vs.zones.findIndex((z) => z.id === zoneId);
      if (idx >= 0) {
        return {
          ...vs,
          // Mark userToggled so auto-enable won't later override this
          // deliberate choice (notably after a persisted view restores
          // with the zone hidden and its data subsequently arrives).
          zones: vs.zones.map((z, i) =>
            i === idx ? { ...z, visible: !z.visible, userToggled: true } : z,
          ),
        };
      }
      const def = zones.find((d) => d.id === zoneId);
      if (!def) return vs;
      return {
        ...vs,
        zones: [...vs.zones, { id: zoneId, width: def.defaultWidth, visible: true, userToggled: true }],
      };
    });
  };

  return (
    <div
      className="tbrowse-zone-toggles"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--tbrowse-text)',
      }}
    >
      {zones.map((def) => {
        const visible = visibleById[def.id] ?? false;
        const available = def.isAvailable(data);
        const status = zoneStatus?.[def.id];
        const isLoading = status === 'loading';
        const isError = status === 'error';
        // While loading, the button doesn't toggle (no data to show
        // anyway). On error, the button stays clickable so the user
        // can collapse/expand a previously-shown zone, but it visibly
        // flags that the recent attempt failed.
        const enabled = available && !isLoading;
        const className = [
          'tbrowse-zone-toggle',
          isLoading ? 'tbrowse-zone-loading' : '',
          isError ? 'tbrowse-zone-error' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const titleParts: string[] = [];
        if (isLoading) titleParts.push('Loading…');
        else if (isError) titleParts.push('Load failed — click to retry from the host');
        else if (!available) titleParts.push('Unavailable: required data missing');
        return (
          <button
            key={def.id}
            type="button"
            className={className}
            onClick={() => toggle(def.id)}
            disabled={!enabled}
            title={titleParts.join(' ') || undefined}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              lineHeight: 1.4,
              borderRadius: 3,
              // Error state overrides the standard accent border via the
              // `tbrowse-zone-error` class (defined in theme.ts) so it
              // wins visually without inline-style fighting.
              border: `1px solid ${visible ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
              background: visible ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
              color: available
                ? visible
                  ? 'var(--tbrowse-accent-strong)'
                  : 'var(--tbrowse-text)'
                : 'var(--tbrowse-text-subtle)',
              cursor: enabled ? 'pointer' : isLoading ? 'progress' : 'not-allowed',
            }}
          >
            {(() => {
              // Each zone state may carry a user-set `name`; honour it
              // here so the toggle button matches the live header
              // label. Falls back to the factory display name.
              const slot = zoneSlots?.[def.id] as
                | { name?: string }
                | undefined;
              return slot?.name && slot.name !== ''
                ? slot.name
                : def.displayName;
            })()}
          </button>
        );
      })}
    </div>
  );
}
