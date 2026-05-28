import { createStore } from 'zustand/vanilla';
import { persist } from 'zustand/middleware';
import { enableMapSet } from 'immer';

enableMapSet();

// ---------------------------------------------------------------------------
// Frame types registered in the frame registry
// ---------------------------------------------------------------------------

export type FrameType =
  | 'semantic'
  | 'map'
  | 'timeline'
  | 'chart'
  | 'text'
  | 'graph'
  | 'search'
  | 'entity'
  | 'summary';

// ---------------------------------------------------------------------------
// Mosaic-compatible pane tree (binary split tree)
// ---------------------------------------------------------------------------

export interface MosaicSplit {
  direction: 'row' | 'column';
  first: PaneNode;
  second: PaneNode;
  splitPercentage?: number; // 0–100, default 50
}

export type PaneNode = FrameType | MosaicSplit;

export function isLeaf(node: PaneNode): node is FrameType {
  return typeof node === 'string';
}

// ---------------------------------------------------------------------------
// Built-in layout presets
// ---------------------------------------------------------------------------

const PRESETS: Record<string, PaneNode> = {
  '4-panel': {
    direction: 'row',
    first: { direction: 'column', first: 'semantic', second: 'timeline' },
    second: {
      direction: 'column',
      first: { direction: 'row', first: 'map', second: 'chart' },
      second: 'text',
    },
    splitPercentage: 40,
  },
  'map-focus': {
    direction: 'row',
    first: 'map',
    second: { direction: 'column', first: 'semantic', second: 'text' },
    splitPercentage: 60,
  },
  'text-focus': {
    direction: 'row',
    first: 'text',
    second: { direction: 'column', first: 'semantic', second: 'map' },
    splitPercentage: 55,
  },
  single: 'semantic',
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface LayoutState {
  root: PaneNode;
  presets: Record<string, PaneNode>;
  maximized: FrameType | null;

  setRoot: (root: PaneNode) => void;
  savePreset: (name: string) => void;
  loadPreset: (name: string) => void;
  maximize: (frame: FrameType | null) => void;
  replaceFrame: (target: FrameType, replacement: FrameType) => void;
}

function replaceInTree(root: PaneNode, target: FrameType, replacement: FrameType): PaneNode {
  if (isLeaf(root)) return root === target ? replacement : root;
  return {
    ...root,
    first: replaceInTree(root.first, target, replacement),
    second: replaceInTree(root.second, target, replacement),
  };
}

export const layoutStore = createStore<LayoutState>()(
  persist(
    (set, get) => ({
      root: PRESETS['4-panel'],
      presets: { ...PRESETS },
      maximized: null,

      setRoot: (root) => set({ root }),

      savePreset: (name) =>
        set((s) => ({ presets: { ...s.presets, [name]: s.root } })),

      loadPreset: (name) => {
        const preset = get().presets[name];
        if (preset !== undefined) set({ root: preset });
      },

      maximize: (frame) => set({ maximized: frame }),

      replaceFrame: (target, replacement) =>
        set((s) => ({ root: replaceInTree(s.root, target, replacement) })),
    }),
    {
      name: 'kb-viz:layout',
      // Only persist root and user-saved presets (not built-ins, not maximized)
      partialize: (s) => ({
        root: s.root,
        presets: Object.fromEntries(
          Object.entries(s.presets).filter(([k]) => !(k in PRESETS)),
        ),
      }),
    },
  ),
);
