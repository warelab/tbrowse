import { useTBrowseStore } from '../store';
import type { HostData, ZoneDefinition } from '../types';

interface ZoneTogglesProps {
  zones: ZoneDefinition[];
  data: HostData;
}

/**
 * Per-zone visibility toggle buttons. Returned without an outer row
 * wrapper so the parent toolbar can position them inside a sliding
 * panel; renders one button per registered zone, lit when the zone
 * is currently visible.
 */
export function ZoneToggles({ zones, data }: ZoneTogglesProps) {
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
          zones: vs.zones.map((z, i) =>
            i === idx ? { ...z, visible: !z.visible } : z,
          ),
        };
      }
      const def = zones.find((d) => d.id === zoneId);
      if (!def) return vs;
      return {
        ...vs,
        zones: [...vs.zones, { id: zoneId, width: def.defaultWidth, visible: true }],
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
        return (
          <button
            key={def.id}
            type="button"
            onClick={() => toggle(def.id)}
            disabled={!available}
            title={available ? undefined : 'Unavailable: required data missing'}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              lineHeight: 1.4,
              borderRadius: 3,
              border: `1px solid ${visible ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
              background: visible ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
              color: available
                ? visible
                  ? 'var(--tbrowse-accent-strong)'
                  : 'var(--tbrowse-text)'
                : 'var(--tbrowse-text-subtle)',
              cursor: available ? 'pointer' : 'not-allowed',
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
