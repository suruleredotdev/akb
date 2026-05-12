import { describe, it, expect } from 'vitest';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';

describe('stores: initial state', () => {
  it('dataStore starts empty', () => {
    const s = dataStore.getState();
    expect(s.manifest).toBeNull();
    expect(s.nodes.size).toBe(0);
    expect(s.edges.size).toBe(0);
  });

  it('selectionStore starts clear', () => {
    const s = selectionStore.getState();
    expect(s.selected.size).toBe(0);
    expect(s.hovered).toBeNull();
    expect(s.focused).toBeNull();
  });

  it('viewStore defaults to chunk level', () => {
    expect(viewStore.getState().level).toBe('chunk');
  });
});
