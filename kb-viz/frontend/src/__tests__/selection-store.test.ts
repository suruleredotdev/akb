import { describe, it, expect, beforeEach } from 'vitest';
import { selectionStore } from '../state/selection-store';

beforeEach(() => selectionStore.getState().clear());

describe('selectionStore', () => {
  it('starts empty', () => {
    const s = selectionStore.getState();
    expect(s.selected.size).toBe(0);
    expect(s.hovered).toBeNull();
    expect(s.focused).toBeNull();
    expect(s.anchor).toBeNull();
  });

  it('toggle adds a node', () => {
    selectionStore.getState().toggle('a');
    expect(selectionStore.getState().selected.has('a')).toBe(true);
  });

  it('toggle removes an already-selected node', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().toggle('a');
    expect(selectionStore.getState().selected.has('a')).toBe(false);
  });

  it('selectOnly replaces selection and sets anchor', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().selectOnly('b');
    const s = selectionStore.getState();
    expect(s.selected.size).toBe(1);
    expect(s.selected.has('b')).toBe(true);
    expect(s.anchor).toBe('b');
  });

  it('boxSelect replaces selection with given ids', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().boxSelect(['b', 'c']);
    const s = selectionStore.getState();
    expect(s.selected.has('a')).toBe(false);
    expect(s.selected.has('b')).toBe(true);
    expect(s.selected.has('c')).toBe(true);
    expect(s.focused).toBe('b');
    expect(s.anchor).toBe('b');
  });

  it('boxSelect with empty array clears selection', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().boxSelect([]);
    expect(selectionStore.getState().selected.size).toBe(0);
  });

  it('addToSelection unions without clearing', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().addToSelection(['b', 'c']);
    const s = selectionStore.getState();
    expect(s.selected.has('a')).toBe(true);
    expect(s.selected.has('b')).toBe(true);
    expect(s.selected.has('c')).toBe(true);
  });

  it('clear resets all fields', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().hover('b');
    selectionStore.getState().clear();
    const s = selectionStore.getState();
    expect(s.selected.size).toBe(0);
    expect(s.hovered).toBeNull();
    expect(s.focused).toBeNull();
    expect(s.anchor).toBeNull();
  });

  it('setAnchor updates anchor without changing selection', () => {
    selectionStore.getState().toggle('a');
    selectionStore.getState().setAnchor('a');
    expect(selectionStore.getState().anchor).toBe('a');
    expect(selectionStore.getState().selected.has('a')).toBe(true);
  });
});
