import { useMemo, type ReactNode } from 'react';
import type { ZoneDefinition, ZoneRenderProps } from '../../types';
import { allFields, builtInFields, providerFields, type LabelField } from './fields';
import { LabelsConfigPopover } from './ConfigPopover';
import { EditableZoneName } from '../EditableZoneName';
import { useProviderCache } from './providerCache';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';
import { compileStringMatcher } from '../../search/fields';
import { buildChildrenIndex } from '../../treeIndex';
import { describeHoveredNodeForHeader } from '../headerInfo';

export interface LabelsZoneState {
  /** User-set zone name; falls back to the factory default when undefined. */
  name?: string;
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
  hoveredNodeId,
}: ZoneRenderProps<LabelsZoneState>) => {
  const fields = useMemo(() => allFields(data), [data]);
  const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);
  const hoveredInfo = useMemo(
    () => describeHoveredNodeForHeader(hoveredNodeId, data, childrenIndex),
    [hoveredNodeId, data, childrenIndex],
  );
  const visibleCount = zoneState.visibleFields.length;
  return (
    <div
      data-labels-zone-header
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: 'var(--tbrowse-text)',
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
        <EditableZoneName
          defaultName="Labels"
          customName={zoneState?.name}
          onChange={(next) =>
            setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), name: next }))
          }
        />
        <span
          style={{
            fontWeight: 400,
            color: 'var(--tbrowse-text-muted)',
            fontSize: 11,
          }}
        >
          {visibleCount}/{fields.length} field{fields.length === 1 ? '' : 's'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <LabelsConfigPopover
            fields={fields}
            visibleFields={zoneState.visibleFields}
            onChange={(next) =>
              setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), visibleFields: next }))
            }
          />
        </span>
      </div>
      <div
        style={{
          flex: `0 0 ${LEAF_ROW_HEIGHT}px`,
          minHeight: 0,
          padding: '0 10px 0 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--tbrowse-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={hoveredInfo ?? ''}
      >
        {hoveredInfo ?? (
          <span style={{ color: 'var(--tbrowse-text-subtle)' }}>
            hover a node…
          </span>
        )}
      </div>
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
  searchState,
  searchResults,
  onHoverNode,
  onSelectNode,
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

  // Compile the search query once per (query, flags) change. The
  // labels zone applies it to every visible label part — so a
  // matching substring inside any rendered field gets a `<mark>`
  // span. We don't gate on `matchedLeafIds`: a leaf might match via
  // a search field whose value isn't one of the visible label
  // fields (e.g. the leaf matched on `node-id` but the user is
  // showing only gene id and taxonomy), in which case no label
  // substring matches and nothing is marked — that's correct.
  const labelMatcher = useMemo(() => {
    if (!searchState || !searchState.query) return null;
    const m = compileStringMatcher(searchState.query, {
      caseSensitive: searchState.caseSensitive ?? false,
      regex: searchState.regex ?? false,
    });
    return m.ok ? m : null;
  }, [searchState]);
  // Skip the per-part match search entirely on rows that didn't
  // match — saves a string scan per visible label part.
  const matchedLeafIds = searchResults.matchedLeafIds;

  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

  return (
    <>
      {rows.map((r) => {
        const isExactHover = hoveredNodeId === r.nodeId;
        const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
        const isSelected = selectedNodeId === r.nodeId;

        const isCollapsed = r.kind === 'collapsedSummary';
        // Highlighting only applies when the row is a search match
        // AND we have a compiled matcher. Both conditions are cheap
        // to test and the common case (no search) costs nothing.
        const matcher =
          !isCollapsed && labelMatcher && matchedLeafIds.has(r.nodeId)
            ? labelMatcher
            : null;
        const displayText = isCollapsed
          ? collapsedSummaryLabel(r.nodeId, r.leafCount, data)
          : leafLabel(r.nodeId, activeFields, data, providerCache);
        const displayNode = isCollapsed
          ? displayText
          : leafLabelNode(
              r.nodeId,
              activeFields,
              data,
              providerCache,
              matcher,
            );

        return (
          <div
            key={r.nodeId}
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
            // Click selects the row's node so the tree zone opens its
            // tooltip. We bail when the user has actually highlighted
            // text (drag-select) so copying labels still works.
            onClick={() => {
              const sel = window.getSelection();
              if (sel && sel.toString().length > 0) return;
              onSelectNode(r.nodeId);
            }}
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
                ? 'var(--tbrowse-row-select-bg)'
                : isExactHover
                  ? 'var(--tbrowse-row-hover-bg)'
                  : isInHoveredSubtree
                    ? 'var(--tbrowse-row-subtree-bg)'
                    : 'transparent',
              fontWeight: isInHoveredSubtree ? 600 : 400,
              fontStyle: isCollapsed ? 'italic' : 'normal',
              color: isCollapsed ? 'var(--tbrowse-text-muted)' : 'var(--tbrowse-text)',
              borderBottom: '1px solid var(--tbrowse-border-row)',
              cursor: 'pointer',
              // Allow drag-selection of text for copy/paste even though
              // the row is clickable (the click handler ignores clicks
              // that produced a non-empty selection).
              userSelect: 'text',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: r.opacity ?? 1,
              transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
            }}
            // Title stays plain text; React highlights only the
            // visible label, copy-paste still gets the original.
            title={displayText}
          >
            {displayNode}
          </div>
        );
      })}
    </>
  );
};

/** Build the rendered label as a list of ReactNode parts so the
 *  search matcher can wrap matching substrings in `<mark>` without
 *  touching the underlying field values. The companion `leafLabel`
 *  produces the plain string version used for the title attribute
 *  and copy-paste fidelity. */
function leafLabelNode(
  nodeId: string,
  fields: LabelField[],
  data: ZoneRenderProps['data'],
  cache: ReturnType<typeof useProviderCache>,
  matcher: { spanOf: (s: string) => [number, number] | null } | null,
): ReactNode {
  const node = data.tree.nodes[nodeId];
  if (!node) return '?';
  const out: ReactNode[] = [];
  for (const f of fields) {
    let v: string | null = null;
    if (f.kind === 'builtin') {
      v = f.get(node, data);
    } else if (node.geneId) {
      const cached = cache.get(f.providerId, node.geneId);
      v = cached === 'pending' ? PENDING_PLACEHOLDER : cached;
    }
    if (v === null || v === '') continue;
    if (out.length > 0) {
      out.push(
        <span key={`s-${f.id}`} aria-hidden="true">
          {FIELD_SEPARATOR}
        </span>,
      );
    }
    out.push(<LabelPart key={f.id} value={v} matcher={matcher} />);
  }
  return out.length > 0 ? <>{out}</> : '—';
}

function LabelPart({
  value,
  matcher,
}: {
  value: string;
  matcher: { spanOf: (s: string) => [number, number] | null } | null;
}) {
  if (!matcher) return <>{value}</>;
  const span = matcher.spanOf(value);
  if (!span || span[0] === span[1]) return <>{value}</>;
  return (
    <>
      {value.slice(0, span[0])}
      <mark
        style={{
          background: 'var(--tbrowse-search-soft)',
          color: 'inherit',
          padding: 0,
          borderRadius: 2,
        }}
      >
        {value.slice(span[0], span[1])}
      </mark>
      {value.slice(span[1])}
    </>
  );
}

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
  defaultWidth: 20,
  minWidth: 100,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) => Boolean(data.tree),
};

// Re-exports so consumers don't need to reach into ./fields.
export { builtInFields, providerFields };
