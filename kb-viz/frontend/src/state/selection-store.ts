import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';

export interface SelectionState {
  selected: Set<NodeId>;
  hovered: NodeId | null;
  focused: NodeId | null;
  toggle: (id: NodeId) => void;
  selectOnly: (id: NodeId) => void;
  setFocused: (id: NodeId | null) => void;
  hover: (id: NodeId | null) => void;
  clear: () => void;
}

export const selectionStore = createStore<SelectionState>((set) => ({
  selected: new Set(),
  hovered: null,
  focused: null,
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next, focused: id };
    }),
  selectOnly: (id) => set({ selected: new Set([id]), focused: id }),
  setFocused: (id) => set({ focused: id }),
  hover: (id) => set({ hovered: id }),
  clear: () => set({ selected: new Set(), focused: null, hovered: null }),
}));
