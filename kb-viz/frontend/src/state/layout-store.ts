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
  | 'summary'
  | 'llm';

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
      direction: 'row',
      first: {
        direction: 'column',
        first: { direction: 'row', first: 'map', second: 'summary', splitPercentage: 55 },
        second: 'text',
      },
      second: 'llm',
      splitPercentage: 65,
    },
    splitPercentage: 30,
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
  'llm-focus': {
    direction: 'row',
    first: { direction: 'column', first: 'semantic', second: 'text' },
    second: 'llm',
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
  removeFrame: (target: FrameType) => void;
}

export function replaceInTree(root: PaneNode, target: FrameType, replacement: FrameType): PaneNode {
  if (isLeaf(root)) return root === target ? replacement : root;
  return {
    ...root,
    first: replaceInTree(root.first, target, replacement),
    second: replaceInTree(root.second, target, replacement),
  };
}

/** Returns null when the node itself should be removed; the caller collapses the split. */
export function removeFromTree(root: PaneNode, target: FrameType): PaneNode | null {
  if (isLeaf(root)) return root === target ? null : root;
  const newFirst = removeFromTree(root.first, target);
  const newSecond = removeFromTree(root.second, target);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  return { ...root, first: newFirst, second: newSecond };
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

      removeFrame: (target) =>
        set((s) => {
          const next = removeFromTree(s.root, target);
          // Never leave an empty layout
          if (next === null) return s;
          const maximized = s.maximized === target ? null : s.maximized;
          return { root: next, maximized };
        }),
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
