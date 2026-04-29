import { useTBrowseStore } from '../store';
import type { HostData, ZoneDefinition } from '../types';

interface ChromeStripProps {
  zones: ZoneDefinition[];
  data: HostData;
}

export function ChromeStrip({ zones, data }: ChromeStripProps) {
  const zoneStates = useTBrowseStore((s) => s.viewState.zones);
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
      className="tbrowse-chrome"
      style={{
        height: 28,
        flexShrink: 0,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: '1px solid #ddd',
        background: '#fafafa',
        fontSize: 11,
      }}
    >
      <span style={{ color: '#666', marginRight: 4 }}>Zones:</span>
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
              border: '1px solid ' + (visible ? '#2878dc' : '#ccc'),
              background: visible ? '#e6f0fb' : 'white',
              color: available ? (visible ? '#1d5fb1' : '#333') : '#999',
              cursor: available ? 'pointer' : 'not-allowed',
            }}
          >
            {def.displayName}
          </button>
        );
      })}
    </div>
  );
}
