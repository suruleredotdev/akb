import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';

export interface SelectionState {
  selected: Set<NodeId>;
  hovered: NodeId | null;
  focused: NodeId | null;
  anchor: NodeId | null;

  toggle: (id: NodeId) => void;
  selectOnly: (id: NodeId) => void;
  setFocused: (id: NodeId | null) => void;
  hover: (id: NodeId | null) => void;
  clear: () => void;
  // Multi-select
  boxSelect: (ids: NodeId[]) => void;
  addToSelection: (ids: NodeId[]) => void;
  setAnchor: (id: NodeId | null) => void;
}

export const selectionStore = createStore<SelectionState>()((set) => ({
  selected: new Set(),
  hovered: null,
  focused: null,
  anchor: null,

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next, focused: id };
    }),

  selectOnly: (id) => set({ selected: new Set([id]), focused: id, anchor: id }),

  setFocused: (id) => set({ focused: id }),

  hover: (id) => set({ hovered: id }),

  clear: () => set({ selected: new Set(), focused: null, hovered: null, anchor: null }),

  boxSelect: (ids) =>
    set({ selected: new Set(ids), focused: ids[0] ?? null, anchor: ids[0] ?? null }),

  addToSelection: (ids) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const id of ids) next.add(id);
      return { selected: next };
    }),

  setAnchor: (id) => set({ anchor: id }),
}));
