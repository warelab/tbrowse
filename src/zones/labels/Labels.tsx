import { useMemo } from 'react';
import type { ZoneDefinition, ZoneRenderProps } from '../../types';
import { allFields, builtInFields, providerFields, type LabelField } from './fields';
import { FieldPicker } from './FieldPicker';
import { useProviderCache } from './providerCache';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';

export interface LabelsZoneState {
  visibleFields: string[];
}

const DEFAULT_STATE: LabelsZoneState = {
  visibleFields: ['taxonomy.commonName', 'gene.id'],
};

const FIELD_SEPARATOR = ' · ';
const PENDING_PLACEHOLDER = '…';

const LabelsHeader = ({
  zoneState,
  setZoneState,
  data,
}: ZoneRenderProps<LabelsZoneState>) => {
  const fields = useMemo(() => allFields(data), [data]);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: '#333',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px 0 18px',
        }}
      >
        <span style={{ fontWeight: 600 }}>Labels</span>
        <FieldPicker
          fields={fields}
          visibleFields={zoneState.visibleFields}
          onChange={(next) =>
            setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), visibleFields: next }))
          }
        />
      </div>
      {/* Reserved second row, kept empty for visual alignment with other zone headers. */}
      <div style={{ flex: `0 0 ${LEAF_ROW_HEIGHT}px`, minHeight: 0 }} />
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
}: ZoneRenderProps<LabelsZoneState>) => {
  const allDefinedFields = useMemo(() => allFields(data), [data]);

  const activeFields = useMemo<LabelField[]>(() => {
    const byId = new Map(allDefinedFields.map((f) => [f.id, f]));
    return zoneState.visibleFields
      .map((id) => byId.get(id))
      .filter((f): f is LabelField => f !== undefined);
  }, [zoneState.visibleFields, allDefinedFields]);

  // Provider fetches need geneIds across all currently-visible leaves.
  // Use the FULL visibleRows (not the windowed rowRange) so scroll doesn't
  // tear down in-flight fetches.
  const activeProviders = useMemo(() => {
    if (!data.labelProviders) return [];
    const wantedProviderIds = new Set(
      activeFields.filter((f) => f.kind === 'provider').map((f) => f.providerId),
    );
    return data.labelProviders.filter((p) => wantedProviderIds.has(p.id));
  }, [data.labelProviders, activeFields]);

  const allGeneIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of visibleRows) {
      if (r.kind !== 'leaf') continue;
      const node = data.tree.nodes[r.nodeId];
      if (node?.geneId) ids.push(node.geneId);
    }
    return ids;
  }, [visibleRows, data.tree]);

  const providerCache = useProviderCache(activeProviders, allGeneIds);

  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

  return (
    <>
      {rows.map((r) => {
        const isExactHover = hoveredNodeId === r.nodeId;
        const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
        const isSelected = selectedNodeId === r.nodeId;

        const isCollapsed = r.kind === 'collapsedSummary';
        const display = isCollapsed
          ? collapsedSummaryLabel(r.nodeId, r.leafCount, data)
          : leafLabel(r.nodeId, activeFields, data, providerCache);

        return (
          <div
            key={r.nodeId}
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
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
              // Default text cursor + native selection — clicking does NOT
              // trigger node selection in non-tree zones; the tree zone is
              // the single source of truth for "selected node".
              cursor: 'text',
              userSelect: 'text',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: r.opacity ?? 1,
              transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
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

function leafLabel(
  nodeId: string,
  fields: LabelField[],
  data: ZoneRenderProps['data'],
  cache: ReturnType<typeof useProviderCache>,
): string {
  const node = data.tree.nodes[nodeId];
  if (!node) return '?';
  const parts: string[] = [];
  for (const f of fields) {
    if (f.kind === 'builtin') {
      const v = f.get(node, data);
      if (v !== null && v !== '') parts.push(v);
    } else {
      if (!node.geneId) continue;
      const v = cache.get(f.providerId, node.geneId);
      if (v === 'pending') parts.push(PENDING_PLACEHOLDER);
      else if (v !== null && v !== '') parts.push(v);
    }
  }
  return parts.length > 0 ? parts.join(FIELD_SEPARATOR) : '—';
}

function collapsedSummaryLabel(
  nodeId: string,
  leafCount: number,
  data: ZoneRenderProps['data'],
): string {
  const node = data.tree.nodes[nodeId];
  if (node && node.taxonomyId !== undefined && data.taxonomy?.[node.taxonomyId]) {
    const tax = data.taxonomy[node.taxonomyId];
    const name = tax.scientificName ?? tax.commonName;
    if (name) return `(${leafCount}) ${name}`;
  }
  return `(${leafCount} leaves)`;
}

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

// Re-exports so consumers don't need to reach into ./fields.
export { builtInFields, providerFields };
