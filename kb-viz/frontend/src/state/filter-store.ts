import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';
import { dataStore } from './data-store';

export interface DateRange {
  startMs: number;
  endMs: number;
}

export interface FilterState {
  // Predicates
  typeFilter: Set<string>;           // empty = all types shown
  annotationTypes: Set<string>;      // empty = no annotation-type filter
  dateRange: DateRange | null;
  spatialPolygon: [number, number][] | null;
  textQuery: string;
  filterToSelection: boolean;        // when true, canvas frames show only selected nodes

  // Derived
  activeIds: Set<NodeId>;

  // Actions
  setTypeFilter: (types: Set<string>) => void;
  toggleAnnotationType: (type: string) => void;
  setDateRange: (range: DateRange | null) => void;
  setSpatialPolygon: (ring: [number, number][] | null) => void;
  setTextQuery: (q: string) => void;
  setFilterToSelection: (v: boolean) => void;
  reset: () => void;
}

function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function computeActiveIds(state: Omit<FilterState, 'activeIds' | keyof FilterActions>): Set<NodeId> {
  const { nodes } = dataStore.getState();
  const result = new Set<NodeId>();

  for (const [id, node] of nodes) {
    if (state.typeFilter.size > 0 && !state.typeFilter.has(node.type)) continue;

    if (state.annotationTypes.size > 0) {
      const hasAny = node.annotations.some((a) => state.annotationTypes.has(a.type));
      if (!hasAny) continue;
    }

    if (state.dateRange) {
      const { startMs, endMs } = state.dateRange;
      const hasInRange = node.annotations.some((a) => {
        if (a.value.kind !== 'temporal') return false;
        const t = Date.parse(a.value.iso_start);
        return !Number.isNaN(t) && t >= startMs && t <= endMs;
      });
      // Also check summary centroid
      const centroid = node.summary?.frame_summaries?.['timeline']?.centroid;
      const centroidInRange =
        centroid && centroid.length >= 1
          ? centroid[0] * 1000 >= startMs && centroid[0] * 1000 <= endMs
          : false;
      if (!hasInRange && !centroidInRange) continue;
    }

    if (state.spatialPolygon) {
      const hasInside = node.annotations.some((a) => {
        if (a.value.kind !== 'geographic') return false;
        return pointInPolygon([a.value.lng, a.value.lat], state.spatialPolygon!);
      });
      if (!hasInside) continue;
    }

    if (state.textQuery) {
      const q = state.textQuery.toLowerCase();
      if (!node.text?.toLowerCase().includes(q)) continue;
    }

    result.add(id);
  }

  return result;
}

type FilterActions = Pick<
  FilterState,
  'setTypeFilter' | 'toggleAnnotationType' | 'setDateRange' | 'setSpatialPolygon' | 'setTextQuery' | 'reset'
>;

function derive(patch: Partial<Omit<FilterState, 'activeIds' | keyof FilterActions>>, current: FilterState) {
  const next = { ...current, ...patch };
  return { ...patch, activeIds: computeActiveIds(next) };
}

export const filterStore = createStore<FilterState>()((set, get) => ({
  typeFilter: new Set(),
  annotationTypes: new Set(),
  dateRange: null,
  spatialPolygon: null,
  textQuery: '',
  filterToSelection: false,
  activeIds: new Set(dataStore.getState().nodes.keys()),

  setTypeFilter: (typeFilter) => set((s) => derive({ typeFilter }, s)),

  toggleAnnotationType: (type) =>
    set((s) => {
      const next = new Set(s.annotationTypes);
      next.has(type) ? next.delete(type) : next.add(type);
      return derive({ annotationTypes: next }, s);
    }),

  setDateRange: (dateRange) => set((s) => derive({ dateRange }, s)),

  setSpatialPolygon: (spatialPolygon) => set((s) => derive({ spatialPolygon }, s)),

  setTextQuery: (textQuery) => set((s) => derive({ textQuery }, s)),

  setFilterToSelection: (filterToSelection) => set({ filterToSelection }),

  reset: () =>
    set((s) =>
      derive(
        { typeFilter: new Set(), annotationTypes: new Set(), dateRange: null, spatialPolygon: null, textQuery: '' },
        s,
      )
    ),
}));

// Re-derive activeIds whenever dataStore loads a new manifest
dataStore.subscribe((data) => {
  if (data.nodes.size > 0) {
    filterStore.getState().reset();
  }
});
