import { describe, it, expect, beforeEach } from 'vitest';
import { layoutStore, isLeaf, type MosaicSplit } from '../state/layout-store';

beforeEach(() => {
  layoutStore.getState().loadPreset('4-panel');
  layoutStore.getState().maximize(null);
});

describe('layoutStore', () => {
  it('loads 4-panel preset by default', () => {
    const root = layoutStore.getState().root;
    expect(isLeaf(root)).toBe(false);
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

  it('maximize stores the frame', () => {
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

  it('replaceFrame swaps deep leaf', () => {
    layoutStore.getState().loadPreset('map-focus');
    layoutStore.getState().replaceFrame('semantic', 'graph');
    const root = layoutStore.getState().root as MosaicSplit;
    const right = root.second as MosaicSplit;
    expect(right.first).toBe('graph');
  });
});
