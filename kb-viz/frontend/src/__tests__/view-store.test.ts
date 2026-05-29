import { describe, it, expect, beforeEach } from 'vitest';
import { viewStore } from '../state/view-store';
import { selectionStore } from '../state/selection-store';
import { dataStore } from '../state/data-store';
import type { Manifest, Node } from '../types/manifest';

// ---------------------------------------------------------------------------
// Minimal manifest helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Node> & { id: string }): Node {
  return {
    type: 'chunk',
    parent_id: null,
    child_ids: [],
    text: null,
    embedding: null,
    embedding_model: null,
    properties: {},
    annotations: [],
    summary: null,
    ...overrides,
  };
}

function makeManifest(nodes: Node[]): Manifest {
  return {
    version: '1',
    schema_id: 'test',
    label: 'test',
    node_types: [
      { id: 'document',   parent_types: [],           child_types: ['chunk'],      display: { label: 'Document',   color: '#fff', icon: null } },
      { id: 'chunk',      parent_types: ['document'],  child_types: ['expression'], display: { label: 'Chunk',      color: '#aaa', icon: null } },
      { id: 'expression', parent_types: ['chunk'],     child_types: [],             display: { label: 'Expression', color: '#888', icon: null } },
    ],
    annotation_types: [],
    frames: [],
    nodes,
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Two-level tree: 1 doc → 2 chunks → 2 expressions each
// ---------------------------------------------------------------------------
const doc1     = makeNode({ id: 'doc1', type: 'document', child_ids: ['c1', 'c2'] });
const chunk1   = makeNode({ id: 'c1', type: 'chunk', parent_id: 'doc1', child_ids: ['e1', 'e2'] });
const chunk2   = makeNode({ id: 'c2', type: 'chunk', parent_id: 'doc1', child_ids: ['e3', 'e4'] });
const expr1    = makeNode({ id: 'e1', type: 'expression', parent_id: 'c1' });
const expr2    = makeNode({ id: 'e2', type: 'expression', parent_id: 'c1' });
const expr3    = makeNode({ id: 'e3', type: 'expression', parent_id: 'c2' });
const expr4    = makeNode({ id: 'e4', type: 'expression', parent_id: 'c2' });

const ALL_NODES = [doc1, chunk1, chunk2, expr1, expr2, expr3, expr4];

beforeEach(() => {
  dataStore.getState().load(makeManifest(ALL_NODES));
  selectionStore.getState().clear();
  viewStore.getState().setLevel('chunk');
  // reset to known state without triggering selection side-effects
  selectionStore.getState().clear();
});

describe('viewStore.setLevel — level transition selection carry-over', () => {
  it('no selection → level changes, nothing selected', () => {
    viewStore.getState().setLevel('document');
    expect(selectionStore.getState().selected.size).toBe(0);
    expect(viewStore.getState().level).toBe('document');
  });

  it('going down doc→chunk selects all chunks of selected doc', () => {
    viewStore.getState().setLevel('document');
    selectionStore.getState().selectOnly('doc1');
    viewStore.getState().setLevel('chunk');
    const sel = selectionStore.getState().selected;
    expect(sel.has('c1')).toBe(true);
    expect(sel.has('c2')).toBe(true);
    expect(sel.size).toBe(2);
  });

  it('going down chunk→expression selects all expressions of selected chunk', () => {
    viewStore.getState().setLevel('chunk');
    selectionStore.getState().selectOnly('c1');
    viewStore.getState().setLevel('expression');
    const sel = selectionStore.getState().selected;
    expect(sel.has('e1')).toBe(true);
    expect(sel.has('e2')).toBe(true);
    expect(sel.has('e3')).toBe(false);
    expect(sel.size).toBe(2);
  });

  it('going down two levels doc→expression selects all expressions of selected doc', () => {
    viewStore.getState().setLevel('document');
    selectionStore.getState().selectOnly('doc1');
    viewStore.getState().setLevel('expression');
    const sel = selectionStore.getState().selected;
    expect(sel.size).toBe(4);
    expect(sel.has('e1') && sel.has('e2') && sel.has('e3') && sel.has('e4')).toBe(true);
  });

  it('going down with multiple selected chunks selects expressions of all of them', () => {
    viewStore.getState().setLevel('chunk');
    selectionStore.getState().boxSelect(['c1', 'c2']);
    viewStore.getState().setLevel('expression');
    const sel = selectionStore.getState().selected;
    expect(sel.size).toBe(4);
  });

  it('going up chunk→document selects the parent document', () => {
    viewStore.getState().setLevel('chunk');
    selectionStore.getState().selectOnly('c1');
    viewStore.getState().setLevel('document');
    const sel = selectionStore.getState().selected;
    expect(sel.has('doc1')).toBe(true);
    expect(sel.size).toBe(1);
  });

  it('going up expression→chunk selects parent chunk', () => {
    viewStore.getState().setLevel('expression');
    selectionStore.getState().selectOnly('e1');
    viewStore.getState().setLevel('chunk');
    const sel = selectionStore.getState().selected;
    expect(sel.has('c1')).toBe(true);
    expect(sel.size).toBe(1);
  });

  it('going up expression→document walks two levels', () => {
    viewStore.getState().setLevel('expression');
    selectionStore.getState().selectOnly('e3');
    viewStore.getState().setLevel('document');
    const sel = selectionStore.getState().selected;
    expect(sel.has('doc1')).toBe(true);
    expect(sel.size).toBe(1);
  });

  it('going up with expressions from different chunks deduplicates the parent document', () => {
    viewStore.getState().setLevel('expression');
    selectionStore.getState().boxSelect(['e1', 'e3']); // both under doc1
    viewStore.getState().setLevel('document');
    const sel = selectionStore.getState().selected;
    expect(sel.size).toBe(1);
    expect(sel.has('doc1')).toBe(true);
  });

  it('going down when node has no children keeps existing selection unchanged', () => {
    viewStore.getState().setLevel('expression');
    selectionStore.getState().selectOnly('e1'); // leaf node
    viewStore.getState().setLevel('chunk'); // going up, should pick parent
    expect(selectionStore.getState().selected.has('c1')).toBe(true);
  });

  it('focused is set to first id after level transition', () => {
    viewStore.getState().setLevel('document');
    selectionStore.getState().selectOnly('doc1');
    viewStore.getState().setLevel('chunk');
    const { focused } = selectionStore.getState();
    expect(focused === 'c1' || focused === 'c2').toBe(true);
  });
});
