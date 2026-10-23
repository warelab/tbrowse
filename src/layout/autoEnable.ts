import type { HostData, ViewState, ZoneDefinition, ZoneViewState } from '../types';

/**
 * The view-state update `Layout` applies when zone data first arrives:
 * every zone in `newlyAvailable` that is hidden and was never toggled by
 * the user turns visible, and a zone with no entry in `vs.zones` gets one.
 *
 * Linked exclusive groups keep a single slot: at most one member is
 * revealed per pass, and none while a sibling already holds the slot. A
 * sibling holds it only when it actually renders — `visible` AND
 * `isAvailable(data)`, the same test `Layout` applies when it lays zones
 * out. A stale `visible: true` on a sibling whose data never came (a
 * persisted view, or a host that seeds every zone visible) therefore does
 * not keep a zone with real data off the row. Unlinked groups
 * (`vs.unlinkedZoneGroups`) behave like plain zones.
 *
 * Returns `vs` itself when nothing changes.
 */
export function autoEnableZones(
  vs: ViewState,
  zones: readonly ZoneDefinition[],
  newlyAvailable: readonly string[],
  data: HostData,
): ViewState {
  if (newlyAvailable.length === 0) return vs;
  const unlinkedSet = new Set(vs.unlinkedZoneGroups ?? []);
  const defById = new Map<string, ZoneDefinition>();
  for (const d of zones) defById.set(d.id, d);
  const groupOf = (id: string): string | undefined => {
    const g = defById.get(id)?.exclusiveGroup;
    return g && !unlinkedSet.has(g) ? g : undefined;
  };
  const groupClaimed = new Set<string>();
  for (const z of vs.zones) {
    if (!z.visible) continue;
    const g = groupOf(z.id);
    if (!g) continue;
    const def = defById.get(z.id);
    if (def && def.isAvailable(data)) groupClaimed.add(g);
  }
  const canEnable = (id: string): boolean => {
    const g = groupOf(id);
    if (!g) return true;
    if (groupClaimed.has(g)) return false;
    groupClaimed.add(g); // claim the group's single slot
    return true;
  };
  const next: ZoneViewState[] = vs.zones.map((z) =>
    newlyAvailable.includes(z.id) && !z.visible && !z.userToggled && canEnable(z.id)
      ? { ...z, visible: true }
      : z,
  );
  // Add an entry for any zone the existing list is missing (rare — only
  // if the host hand-built `zones` without all registered ids).
  const seen = new Set(next.map((z) => z.id));
  for (const id of newlyAvailable) {
    if (seen.has(id)) continue;
    const def = defById.get(id);
    if (!def) continue;
    next.push({ id, width: def.defaultWidth, visible: canEnable(id) });
  }
  const changed = next.length !== vs.zones.length || next.some((z, i) => z !== vs.zones[i]);
  return changed ? { ...vs, zones: next } : vs;
}
