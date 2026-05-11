import { createStore } from 'zustand/vanilla';

export type Level = 'document' | 'chunk' | 'expression';

export interface ViewState {
  level: Level;
  setLevel: (l: Level) => void;
}

export const viewStore = createStore<ViewState>((set) => ({
  level: 'chunk',
  setLevel: (level) => set({ level }),
}));
