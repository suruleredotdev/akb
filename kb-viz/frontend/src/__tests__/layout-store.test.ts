import { describe, it, expect, beforeEach } from 'vitest';
import {
  layoutStore,
  isLeaf,
  replaceInTree,
  removeFromTree,
  type MosaicSplit,
  type PaneNode,
} from '../state/layout-store';

beforeEach(() => {
  layoutStore.getState().loadPreset('4-panel');
  layoutStore.getState().maximize(null);
});

// ---------------------------------------------------------------------------
// isLeaf
// ---------------------------------------------------------------------------

describe('isLeaf', () => {
  it('returns true for a FrameType string', () => {
    expect(isLeaf('semantic')).toBe(true);
    expect(isLeaf('map')).toBe(true);
    expect(isLeaf('text')).toBe(true);
  });

  it('returns false for a MosaicSplit object', () => {
    const split: MosaicSplit = { direction: 'row', first: 'semantic', second: 'map' };
    expect(isLeaf(split)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// replaceInTree
// ---------------------------------------------------------------------------

describe('replaceInTree', () => {
  it('replaces a single-leaf root', () => {
    expect(replaceInTree('semantic', 'semantic', 'map')).toBe('map');
  });

  it('returns the root unchanged when target is not present', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    const result = replaceInTree(tree, 'text', 'graph');
    expect(result).toEqual(tree);
  });

  it('replaces the left child of a two-leaf split', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    const result = replaceInTree(tree, 'semantic', 'graph') as MosaicSplit;
    expect(result.first).toBe('graph');
    expect(result.second).toBe('map');
  });

  it('replaces the right child of a two-leaf split', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    const result = replaceInTree(tree, 'map', 'timeline') as MosaicSplit;
    expect(result.first).toBe('semantic');
    expect(result.second).toBe('timeline');
  });

  it('replaces a deeply nested leaf', () => {
    //  row
    //   ├── col
    //   │    ├── semantic
    //   │    └── timeline
    //   └── map
    const tree: PaneNode = {
      direction: 'row',
      first: { direction: 'column', first: 'semantic', second: 'timeline' },
      second: 'map',
    };
    const result = replaceInTree(tree, 'timeline', 'chart') as MosaicSplit;
    const left = result.first as MosaicSplit;
    expect(left.second).toBe('chart');
    expect(left.first).toBe('semantic');
    expect(result.second).toBe('map');
  });

  it('replaces all occurrences when the same frame appears multiple times', () => {
    // Unusual but valid: same type in two leaves
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'semantic' };
    const result = replaceInTree(tree, 'semantic', 'map') as MosaicSplit;
    expect(result.first).toBe('map');
    expect(result.second).toBe('map');
  });

  it('preserves splitPercentage and direction on unaffected splits', () => {
    const tree: PaneNode = {
      direction: 'column',
      first: 'semantic',
      second: 'map',
      splitPercentage: 70,
    };
    const result = replaceInTree(tree, 'semantic', 'text') as MosaicSplit;
    expect(result.direction).toBe('column');
    expect(result.splitPercentage).toBe(70);
  });

  it('does not mutate the original tree', () => {
    const inner: MosaicSplit = { direction: 'row', first: 'semantic', second: 'map' };
    const tree: PaneNode = { direction: 'column', first: inner, second: 'text' };
    replaceInTree(tree, 'semantic', 'graph');
    // inner should be unchanged
    expect(inner.first).toBe('semantic');
  });
});

// ---------------------------------------------------------------------------
// removeFromTree
// ---------------------------------------------------------------------------

describe('removeFromTree', () => {
  it('returns null when root is the only leaf and matches target', () => {
    expect(removeFromTree('semantic', 'semantic')).toBeNull();
  });

  it('returns the leaf unchanged when it does not match', () => {
    expect(removeFromTree('semantic', 'map')).toBe('semantic');
  });

  it('collapses a two-leaf split by returning the surviving sibling — left removed', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    expect(removeFromTree(tree, 'semantic')).toBe('map');
  });

  it('collapses a two-leaf split by returning the surviving sibling — right removed', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    expect(removeFromTree(tree, 'map')).toBe('semantic');
  });

  it('returns the tree unchanged when the target is not present', () => {
    const tree: PaneNode = { direction: 'row', first: 'semantic', second: 'map' };
    expect(removeFromTree(tree, 'text')).toEqual(tree);
  });

  it('removes a deep leaf and collapses its parent split upward', () => {
    //  row
    //   ├── col
    //   │    ├── semantic  ← remove this
    //   │    └── timeline
    //   └── map
    // Expected result after removal:
    //  row
    //   ├── timeline   (col collapsed; timeline is the survivor)
    //   └── map
    const tree: PaneNode = {
      direction: 'row',
      first: { direction: 'column', first: 'semantic', second: 'timeline' },
      second: 'map',
    };
    const result = removeFromTree(tree, 'semantic') as MosaicSplit;
    expect(result.direction).toBe('row');
    expect(result.first).toBe('timeline');
    expect(result.second).toBe('map');
  });

  it('removes a right-side deep leaf and collapses correctly', () => {
    //  row
    //   ├── semantic
    //   └── col
    //        ├── map
    //        └── chart  ← remove this
    // Expected:
    //  row
    //   ├── semantic
    //   └── map
    const tree: PaneNode = {
      direction: 'row',
      first: 'semantic',
      second: { direction: 'column', first: 'map', second: 'chart' },
    };
    const result = removeFromTree(tree, 'chart') as MosaicSplit;
    expect(result.first).toBe('semantic');
    expect(result.second).toBe('map');
  });

  it('handles a 4-panel layout: removing one leaf collapses only its subtree', () => {
    //  row
    //   ├── col-A
    //   │    ├── semantic
    //   │    └── timeline
    //   └── col-B
    //        ├── row-C
    //        │    ├── map
    //        │    └── chart  ← remove
    //        └── text
    const tree: PaneNode = {
      direction: 'row',
      first: { direction: 'column', first: 'semantic', second: 'timeline' },
      second: {
        direction: 'column',
        first: { direction: 'row', first: 'map', second: 'chart' },
        second: 'text',
      },
    };
    const result = removeFromTree(tree, 'chart') as MosaicSplit;
    // col-A unchanged
    expect(result.first).toEqual({ direction: 'column', first: 'semantic', second: 'timeline' });
    // col-B: row-C collapsed to 'map', so col-B is now { col, map, text }
    const colB = result.second as MosaicSplit;
    expect(colB.first).toBe('map');
    expect(colB.second).toBe('text');
  });

  it('does not mutate the original tree', () => {
    const inner: MosaicSplit = { direction: 'row', first: 'semantic', second: 'map' };
    const tree: PaneNode = { direction: 'column', first: inner, second: 'text' };
    removeFromTree(tree, 'semantic');
    expect(inner.first).toBe('semantic');
  });
});

// ---------------------------------------------------------------------------
// layoutStore actions (integration layer over the tree functions)
// ---------------------------------------------------------------------------

describe('layoutStore', () => {
  it('loads 4-panel preset by default', () => {
    expect(isLeaf(layoutStore.getState().root)).toBe(false);
  });

  it('loadPreset switches root', () => {
    layoutStore.getState().loadPreset('single');
    expect(layoutStore.getState().root).toBe('semantic');
  });

  it('loadPreset ignores unknown name', () => {
    const before = layoutStore.getState().root;
    layoutStore.getState().loadPreset('nonexistent');
    expect(layoutStore.getState().root).toEqual(before);
  });

  it('savePreset stores current root under name', () => {
    layoutStore.getState().loadPreset('single');
    layoutStore.getState().savePreset('my-preset');
    layoutStore.getState().loadPreset('4-panel');
    layoutStore.getState().loadPreset('my-preset');
    expect(layoutStore.getState().root).toBe('semantic');
  });

  it('setRoot updates root', () => {
    layoutStore.getState().setRoot('map');
    expect(layoutStore.getState().root).toBe('map');
  });

  it('maximize stores the frame and clear sets null', () => {
    layoutStore.getState().maximize('semantic');
    expect(layoutStore.getState().maximized).toBe('semantic');
    layoutStore.getState().maximize(null);
    expect(layoutStore.getState().maximized).toBeNull();
  });

  it('replaceFrame swaps a leaf in the tree', () => {
    layoutStore.getState().loadPreset('single');
    layoutStore.getState().replaceFrame('semantic', 'map');
    expect(layoutStore.getState().root).toBe('map');
  });

  it('replaceFrame swaps a deep leaf', () => {
    layoutStore.getState().loadPreset('map-focus');
    layoutStore.getState().replaceFrame('semantic', 'graph');
    const root = layoutStore.getState().root as MosaicSplit;
    const right = root.second as MosaicSplit;
    expect(right.first).toBe('graph');
  });

  it('removeFrame removes a frame and collapses its sibling up', () => {
    // Start with single split: { row, semantic, map }
    layoutStore.getState().setRoot({ direction: 'row', first: 'semantic', second: 'map' });
    layoutStore.getState().removeFrame('semantic');
    expect(layoutStore.getState().root).toBe('map');
  });

  it('removeFrame on the last remaining frame is a no-op', () => {
    layoutStore.getState().loadPreset('single'); // root = 'semantic'
    layoutStore.getState().removeFrame('semantic');
    // Should not leave an empty layout
    expect(layoutStore.getState().root).toBe('semantic');
  });

  it('removeFrame on a frame not in the tree is a no-op', () => {
    layoutStore.getState().loadPreset('single');
    const before = layoutStore.getState().root;
    layoutStore.getState().removeFrame('graph');
    expect(layoutStore.getState().root).toEqual(before);
  });

  it('removeFrame clears maximized if the removed frame was maximized', () => {
    layoutStore.getState().setRoot({ direction: 'row', first: 'semantic', second: 'map' });
    layoutStore.getState().maximize('map');
    layoutStore.getState().removeFrame('map');
    expect(layoutStore.getState().maximized).toBeNull();
  });

  it('removeFrame preserves maximized when a different frame is removed', () => {
    layoutStore.getState().setRoot({ direction: 'row', first: 'semantic', second: 'map' });
    layoutStore.getState().maximize('semantic');
    layoutStore.getState().removeFrame('map');
    expect(layoutStore.getState().maximized).toBe('semantic');
  });
});
