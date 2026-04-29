import { useMemo } from 'react';
import type { ZoneDefinition, ZoneRenderProps } from '../../types';
import { builtInFields, type LabelField } from './fields';
import { FieldPicker } from './FieldPicker';

export interface LabelsZoneState {
  visibleFields: string[];
}

const DEFAULT_STATE: LabelsZoneState = {
  visibleFields: ['taxonomy.commonName', 'gene.id'],
};

const FIELD_SEPARATOR = ' · ';

const LabelsHeader = ({
  zoneState,
  setZoneState,
}: ZoneRenderProps<LabelsZoneState>) => {
  return (
    <div
      style={{
        padding: '0 10px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: '#333',
      }}
    >
      <span style={{ fontWeight: 600 }}>Labels</span>
      <FieldPicker
        fields={builtInFields}
        visibleFields={zoneState.visibleFields}
        onChange={(next) =>
          setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), visibleFields: next }))
        }
      />
    </div>
  );
};

const LabelsBody = ({
  visibleRows,
  rowRange,
  zoneState,
  data,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  onHoverNode,
  onSelectNode,
}: ZoneRenderProps<LabelsZoneState>) => {
  const activeFields = useMemo<LabelField[]>(() => {
    const byId = new Map(builtInFields.map((f) => [f.id, f]));
    return zoneState.visibleFields
      .map((id) => byId.get(id))
      .filter((f): f is LabelField => f !== undefined);
  }, [zoneState.visibleFields]);

  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

  return (
    <>
      {rows.map((r) => {
        const isExactHover = hoveredNodeId === r.nodeId;
        const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
        const isSelected = selectedNodeId === r.nodeId;

        let display: string;
        const isCollapsed = r.kind === 'collapsedSummary';
        if (isCollapsed) {
          display = `(${r.leafCount} leaves)`;
        } else {
          const node = data.tree.nodes[r.nodeId];
          if (!node) {
            display = '?';
          } else {
            const parts: string[] = [];
            for (const f of activeFields) {
              const v = f.get(node, data);
              if (v !== null && v !== '') parts.push(v);
            }
            display = parts.length > 0 ? parts.join(FIELD_SEPARATOR) : '—';
          }
        }

        return (
          <div
            key={r.nodeId}
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
            onClick={() => onSelectNode(r.nodeId)}
            style={{
              position: 'absolute',
              top: r.y,
              left: 0,
              right: 0,
              height: r.height,
              fontSize: 12,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              background: isSelected
                ? 'rgba(40, 120, 220, 0.15)'
                : isExactHover
                  ? 'rgba(40, 120, 220, 0.08)'
                  : isInHoveredSubtree
                    ? 'rgba(40, 120, 220, 0.04)'
                    : 'transparent',
              fontWeight: isInHoveredSubtree ? 600 : 400,
              fontStyle: isCollapsed ? 'italic' : 'normal',
              color: isCollapsed ? '#888' : '#222',
              borderBottom: '1px solid #f0f0f0',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={display}
          >
            {display}
          </div>
        );
      })}
    </>
  );
};

export const labelsZone: ZoneDefinition<LabelsZoneState> = {
  id: 'labels',
  displayName: 'Labels',
  Header: LabelsHeader,
  Body: LabelsBody,
  defaultWidth: 220,
  minWidth: 100,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) => Boolean(data.tree),
};
