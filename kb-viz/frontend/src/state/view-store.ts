import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import type { NodeId } from '../types/manifest';
import type { ColorBy } from '../lib/color-encoder';
import type { FrameType } from './layout-store';

export type Level = 'document' | 'chunk' | 'expression';

// Per-frame configuration (extends as new frames are added)
export interface MapFrameConfig {
  basemap: 'dark-matter' | 'positron' | 'satellite';
}

export interface SemanticFrameConfig {
  mode: '2d' | '3d';
  showKnnEdges: boolean;
  knnK: number;
}

export type FrameConfig = MapFrameConfig | SemanticFrameConfig | Record<string, unknown>;

// Per-pane deck.gl view state (camera position)
export interface PaneViewState {
  longitude?: number;
  latitude?: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  // OrthographicView / OrbitView
  target?: [number, number, number];
  rotationX?: number;
  rotationOrbit?: number;
}

export interface ViewState {
  level: Level;
  colorBy: ColorBy;
  scope: 'global' | NodeId;

  // Per-pane camera states keyed by FrameType (last-known position)
  paneViewStates: Partial<Record<FrameType, PaneViewState>>;

  // Per-frame type config
  frameConfigs: Partial<Record<FrameType, FrameConfig>>;

  setLevel: (l: Level) => void;
  setColorBy: (c: ColorBy) => void;
  drillInto: (id: NodeId, childLevel: Level) => void;
  drillOut: () => void;
  setPaneViewState: (frame: FrameType, state: PaneViewState) => void;
  setFrameConfig: (frame: FrameType, config: Partial<FrameConfig>) => void;
}

const DEFAULT_FRAME_CONFIGS: Partial<Record<FrameType, FrameConfig>> = {
  map: { basemap: 'dark-matter' } satisfies MapFrameConfig,
  semantic: { mode: '2d', showKnnEdges: false, knnK: 5 } satisfies SemanticFrameConfig,
};

export const viewStore = createStore<ViewState>()(
  persist(
    (set) => ({
      level: 'chunk',
      colorBy: 'document',
      scope: 'global',
      paneViewStates: {},
      frameConfigs: { ...DEFAULT_FRAME_CONFIGS },

      setLevel: (level) => set({ level }),
      setColorBy: (colorBy) => set({ colorBy }),
      drillInto: (id, childLevel) => set({ scope: id, level: childLevel }),
      drillOut: () => set({ scope: 'global' }),

      setPaneViewState: (frame, state) =>
        set((s) => ({
          paneViewStates: { ...s.paneViewStates, [frame]: state },
        })),

      setFrameConfig: (frame, config) =>
        set((s) => ({
          frameConfigs: {
            ...s.frameConfigs,
            [frame]: { ...(s.frameConfigs[frame] ?? {}), ...config },
          },
        })),
    }),
    {
      name: 'kb-viz:view',
      partialize: (s) => ({
        level: s.level,
        colorBy: s.colorBy,
        paneViewStates: s.paneViewStates,
        frameConfigs: s.frameConfigs,
      }),
    },
  ),
);
