import { useMemo } from 'react';
import { useStore } from './use-store';
import { dataStore, getDescendants } from '../state/data-store';
import { viewStore } from '../state/view-store';
import type { NodeId } from '../types/manifest';

export function useScopedIds(level: string): NodeId[] {
  const byType = useStore(dataStore, (s) => s.byType);
  const byParent = useStore(dataStore, (s) => s.byParent);
  const scope = useStore(viewStore, (s) => s.scope);
  return useMemo(() => {
    const allIds = byType.get(level) ?? [];
    if (scope === 'global') return allIds;
    const desc = getDescendants(byParent, scope);
    return allIds.filter((id) => desc.has(id));
  }, [byType, byParent, scope, level]);
}
