import { useMemo } from 'react';
import { useStore } from './use-store';
import { dataStore, getDescendants } from '../state/data-store';
import { viewStore } from '../state/view-store';
import { filterStore } from '../state/filter-store';
import type { NodeId } from '../types/manifest';

/** Returns true when any filter predicate is currently active. */
function isFiltering(s: { dateRange: unknown; typeFilter: Set<string>; annotationTypes: Set<string>; spatialPolygon: unknown; textQuery: string }): boolean {
  return s.dateRange !== null || s.typeFilter.size > 0 || s.annotationTypes.size > 0 || s.spatialPolygon !== null || s.textQuery !== '';
}

export function useScopedIds(level: string): NodeId[] {
  const byType    = useStore(dataStore,   (s) => s.byType);
  const byParent  = useStore(dataStore,   (s) => s.byParent);
  const scope     = useStore(viewStore,   (s) => s.scope);
  const activeIds = useStore(filterStore, (s) => s.activeIds);
  const filtering = useStore(filterStore, isFiltering);

  return useMemo(() => {
    const allIds = byType.get(level) ?? [];
    // Intersect with filter-store when any filter predicate is active
    const filtered = filtering ? allIds.filter((id) => activeIds.has(id)) : allIds;
    if (scope === 'global') return filtered;
    const desc = getDescendants(byParent, scope);
    return filtered.filter((id) => desc.has(id));
  }, [byType, byParent, scope, level, activeIds, filtering]);
}
