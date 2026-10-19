// Type-level consumer fixture: compiled with `tsc -p` after `npm run build`.
// Imports the root and every subpath so a broken exports map / stub fails here.
import * as core from 'tbrowse-core';
import * as tree from 'tbrowse-core/tree';
import * as parsers from 'tbrowse-core/parsers';
import * as cluster from 'tbrowse-core/cluster';
import * as fetchMod from 'tbrowse-core/fetch';
import * as sources from 'tbrowse-core/sources';
import * as view from 'tbrowse-core/view';
import * as zone from 'tbrowse-core/zone';
import type { Tree, ViewState, ZoneSpec } from 'tbrowse-core';

const t: Tree = { rootId: 'r', nodes: { r: { id: 'r', parentId: null, distance: 0, isLeaf: true, geneId: 'g1' } } };
const idx = tree.buildChildrenIndex(t);
const pivot: ReturnType<typeof core.computePivotState> = core.computePivotState(t, 'g1');
const zones: ZoneSpec[] = [{ id: 'tree', defaultWidth: 30, defaultZoneState: {}, isAvailable: () => true }];
const vs: ViewState = view.buildInitialViewState(zones, { nodeOfInterest: 'g1' });
const limit: number = core.SEARCH_MATCH_LIMIT;
export const used = [idx, pivot, vs, limit, parsers, cluster, fetchMod, sources, zone] as const;
