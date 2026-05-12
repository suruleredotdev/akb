import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';
import type { ColorBy } from '../lib/color-encoder';

export type Level = 'document' | 'chunk' | 'expression';

export interface ViewState {
  level: Level;
  colorBy: ColorBy;
  scope: 'global' | NodeId;
  setLevel: (l: Level) => void;
  setColorBy: (c: ColorBy) => void;
  drillInto: (id: NodeId, childLevel: Level) => void;
  drillOut: () => void;
}

export const viewStore = createStore<ViewState>((set) => ({
  level: 'chunk',
  colorBy: 'document',
  scope: 'global',
  setLevel: (level) => set({ level }),
  setColorBy: (colorBy) => set({ colorBy }),
  drillInto: (id, childLevel) => set({ scope: id, level: childLevel }),
  drillOut: () => set({ scope: 'global' }),
}));
