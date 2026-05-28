import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';

const MAX_HISTORY = 50;

export interface HistoryState {
  visited: NodeId[];   // most-recent first, capped at MAX_HISTORY
  push: (id: NodeId) => void;
  clear: () => void;
}

export const historyStore = createStore<HistoryState>()((set) => ({
  visited: [],

  push: (id) =>
    set((s) => {
      // Deduplicate: bring to front if already present
      const filtered = s.visited.filter((v) => v !== id);
      return { visited: [id, ...filtered].slice(0, MAX_HISTORY) };
    }),

  clear: () => set({ visited: [] }),
}));

// Subscribe to selectionStore focus changes from outside React.
// Import this file once (in frames/index.ts) to activate the listener.
import { selectionStore } from './selection-store';
selectionStore.subscribe((state, prev) => {
  if (state.focused && state.focused !== prev.focused) {
    historyStore.getState().push(state.focused);
  }
});
