import { useStore } from './use-store';
import { useScopedIds } from './use-scoped-ids';
import { selectionStore } from '../state/selection-store';
import { filterStore } from '../state/filter-store';
import type { NodeId } from '../types/manifest';

/**
 * Returns the set of node IDs that canvas frames should render.
 * When "filter to selection" is active and something is selected,
 * returns only the selected IDs; otherwise returns all scoped IDs.
 */
export function useEffectiveIds(level: string): NodeId[] {
  const scopedIds = useScopedIds(level);
  const selected = useStore(selectionStore, (s) => s.selected);
  const filterToSelection = useStore(filterStore, (s) => s.filterToSelection);

  if (filterToSelection && selected.size > 0) {
    return [...selected];
  }
  return scopedIds;
}
