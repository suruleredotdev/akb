import { describe, it, expect, beforeEach } from 'vitest';
import { getDescendants, getAncestors, dataStore } from '../state/data-store';
import type { Manifest, Node, NodeId } from '../types/manifest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Node> & { id: string }): Node {
  return {
    type: 'expression',
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

/** Build a byParent map directly from a node list (mirrors dataStore.load logic). */
function makeByParent(nodes: Node[]): Map<NodeId, NodeId[]> {
  const map = new Map<NodeId, NodeId[]>();
  for (const n of nodes) {
    if (n.parent_id) {
      const arr = map.get(n.parent_id) ?? [];
      arr.push(n.id);
      map.set(n.parent_id, arr);
    }
  }
  return map;
}

function makeNodesById(nodes: Node[]): Map<NodeId, Node> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Minimal valid manifest for dataStore.load tests. */
function makeManifest(nodes: Node[], edges: Manifest['edges'] = []): Manifest {
  return {
    version: '1',
    schema_id: 'test-schema',
    node_types: [],
    annotation_types: [],
    frames: [],
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// getDescendants
// ---------------------------------------------------------------------------

describe('getDescendants', () => {
  it('returns an empty set for a leaf node (not in byParent)', () => {
    const byParent = new Map<NodeId, NodeId[]>();
    expect(getDescendants(byParent, 'leaf').size).toBe(0);
  });

  it('returns an empty set for a node that exists but has no children', () => {
    // key present but empty array
    const byParent = new Map([['node', [] as NodeId[]]]);
    expect(getDescendants(byParent, 'node').size).toBe(0);
  });

  it('returns direct children only when depth is 1', () => {
    const byParent = new Map([['doc', ['c1', 'c2', 'c3']]]);
    const result = getDescendants(byParent, 'doc');
    expect(result).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('does NOT include the root node itself', () => {
    const byParent = new Map([['doc', ['child']]]);
    expect(getDescendants(byParent, 'doc').has('doc')).toBe(false);
  });

  it('traverses document → chunk → expression (3 levels)', () => {
    //  doc
    //   ├── chunk1
    //   │     ├── expr1
    //   │     └── expr2
    //   └── chunk2
    //         └── expr3
    const byParent = new Map([
      ['doc',    ['chunk1', 'chunk2']],
      ['chunk1', ['expr1', 'expr2']],
      ['chunk2', ['expr3']],
    ]);
    const result = getDescendants(byParent, 'doc');
    expect(result).toEqual(new Set(['chunk1', 'chunk2', 'expr1', 'expr2', 'expr3']));
  });

  it('traverses a deep single-child chain', () => {
    const byParent = new Map([['a', ['b']], ['b', ['c']], ['c', ['d']]]);
    expect(getDescendants(byParent, 'a')).toEqual(new Set(['b', 'c', 'd']));
  });

  it('returns only the subtree rooted at the given node, not the whole tree', () => {
    const byParent = new Map([
      ['root', ['left', 'right']],
      ['left', ['ll', 'lr']],
      ['right', ['rl']],
    ]);
    const result = getDescendants(byParent, 'left');
    expect(result).toEqual(new Set(['ll', 'lr']));
    expect(result.has('right')).toBe(false);
    expect(result.has('rl')).toBe(false);
    expect(result.has('root')).toBe(false);
  });

  it('produces a Set so duplicate child references are collapsed', () => {
    // Malformed data: same child listed twice — result still has it once
    const byParent = new Map([['parent', ['child', 'child']]]);
    const result = getDescendants(byParent, 'parent');
    expect(result.size).toBe(1);
    expect(result.has('child')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAncestors
// ---------------------------------------------------------------------------

describe('getAncestors', () => {
  it('returns an empty array for a root node (no parent_id)', () => {
    const nodes = makeNodesById([makeNode({ id: 'root' })]);
    expect(getAncestors(nodes, 'root')).toEqual([]);
  });

  it('returns an empty array for an unknown node ID', () => {
    const nodes = makeNodesById([]);
    expect(getAncestors(nodes, 'missing')).toEqual([]);
  });

  it('returns the single direct parent', () => {
    const chunk = makeNode({ id: 'chunk1' });
    const expr  = makeNode({ id: 'expr1', parent_id: 'chunk1' });
    const nodes = makeNodesById([chunk, expr]);
    expect(getAncestors(nodes, 'expr1')).toEqual([chunk]);
  });

  it('returns the full ancestor chain ordered nearest-first', () => {
    //  doc → chunk → expression
    const doc   = makeNode({ id: 'doc', type: 'document' });
    const chunk = makeNode({ id: 'chunk', type: 'chunk', parent_id: 'doc' });
    const expr  = makeNode({ id: 'expr', type: 'expression', parent_id: 'chunk' });
    const nodes = makeNodesById([doc, chunk, expr]);

    const ancestors = getAncestors(nodes, 'expr');
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0].id).toBe('chunk');  // nearest first
    expect(ancestors[1].id).toBe('doc');
  });

  it('stops gracefully when parent_id points to a missing node', () => {
    const orphan = makeNode({ id: 'orphan', parent_id: 'ghost' });
    const nodes = makeNodesById([orphan]);
    // 'ghost' is not in the map — should return empty rather than throw
    expect(getAncestors(nodes, 'orphan')).toEqual([]);
  });

  it('handles a node whose parent has no further parent (depth-2 chain)', () => {
    const root  = makeNode({ id: 'root' });
    const child = makeNode({ id: 'child', parent_id: 'root' });
    const nodes = makeNodesById([root, child]);
    const ancestors = getAncestors(nodes, 'child');
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0].id).toBe('root');
  });

  it('does not include the queried node itself', () => {
    const parent = makeNode({ id: 'parent' });
    const child  = makeNode({ id: 'child', parent_id: 'parent' });
    const nodes  = makeNodesById([parent, child]);
    const ancestors = getAncestors(nodes, 'child');
    expect(ancestors.map((n) => n.id)).not.toContain('child');
  });
});

// ---------------------------------------------------------------------------
// dataStore.load()
// ---------------------------------------------------------------------------

describe('dataStore.load()', () => {
  beforeEach(() => {
    // Reset to initial state between tests by loading an empty manifest
    dataStore.getState().load(makeManifest([]));
  });

  it('sets schemaId and manifest from the manifest object', () => {
    const manifest = makeManifest([]);
    dataStore.getState().load(manifest);
    const s = dataStore.getState();
    expect(s.schemaId).toBe('test-schema');
    expect(s.manifest).toBe(manifest);
  });

  it('populates nodes map keyed by node ID', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    dataStore.getState().load(makeManifest(nodes));
    const s = dataStore.getState();
    expect(s.nodes.size).toBe(2);
    expect(s.nodes.get('a')?.id).toBe('a');
    expect(s.nodes.get('b')?.id).toBe('b');
  });

  it('builds byType grouping node IDs by their type field', () => {
    const nodes = [
      makeNode({ id: 'doc1',   type: 'document' }),
      makeNode({ id: 'doc2',   type: 'document' }),
      makeNode({ id: 'chunk1', type: 'chunk' }),
      makeNode({ id: 'expr1',  type: 'expression' }),
    ];
    dataStore.getState().load(makeManifest(nodes));
    const { byType } = dataStore.getState();
    expect(byType.get('document')).toEqual(expect.arrayContaining(['doc1', 'doc2']));
    expect(byType.get('document')).toHaveLength(2);
    expect(byType.get('chunk')).toEqual(['chunk1']);
    expect(byType.get('expression')).toEqual(['expr1']);
  });

  it('builds byParent grouping child IDs under their parent', () => {
    const nodes = [
      makeNode({ id: 'doc' }),
      makeNode({ id: 'c1', parent_id: 'doc' }),
      makeNode({ id: 'c2', parent_id: 'doc' }),
      makeNode({ id: 'e1', parent_id: 'c1' }),
    ];
    dataStore.getState().load(makeManifest(nodes));
    const { byParent } = dataStore.getState();
    expect(byParent.get('doc')).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(byParent.get('c1')).toEqual(['e1']);
    expect(byParent.has('e1')).toBe(false); // leaf — no entry
  });

  it('does not add an entry to byParent for root nodes (parent_id null)', () => {
    const nodes = [makeNode({ id: 'root', parent_id: null })];
    dataStore.getState().load(makeManifest(nodes));
    expect(dataStore.getState().byParent.has('root')).toBe(false);
  });

  it('populates edges map keyed by edge ID', () => {
    const edge = { id: 'e1', source: 'a', target: 'b', type: 'next', properties: {} };
    dataStore.getState().load(makeManifest([], [edge]));
    const { edges } = dataStore.getState();
    expect(edges.size).toBe(1);
    expect(edges.get('e1')?.source).toBe('a');
  });

  it('replaces previous state on a second load call', () => {
    dataStore.getState().load(makeManifest([makeNode({ id: 'old' })]));
    dataStore.getState().load(makeManifest([makeNode({ id: 'new1' }), makeNode({ id: 'new2' })]));
    const s = dataStore.getState();
    expect(s.nodes.has('old')).toBe(false);
    expect(s.nodes.size).toBe(2);
  });

  it('handles an empty manifest without errors', () => {
    dataStore.getState().load(makeManifest([]));
    const s = dataStore.getState();
    expect(s.nodes.size).toBe(0);
    expect(s.byType.size).toBe(0);
    expect(s.byParent.size).toBe(0);
    expect(s.edges.size).toBe(0);
  });

  it('byParent and getDescendants are consistent with each other', () => {
    // Verify that byParent built by load() produces correct results when
    // passed to getDescendants — cross-function integration check.
    const nodes = [
      makeNode({ id: 'doc' }),
      makeNode({ id: 'chunk', parent_id: 'doc' }),
      makeNode({ id: 'expr1', parent_id: 'chunk' }),
      makeNode({ id: 'expr2', parent_id: 'chunk' }),
    ];
    dataStore.getState().load(makeManifest(nodes));
    const { byParent } = dataStore.getState();

    const descOfDoc   = getDescendants(byParent, 'doc');
    const descOfChunk = getDescendants(byParent, 'chunk');

    expect(descOfDoc).toEqual(new Set(['chunk', 'expr1', 'expr2']));
    expect(descOfChunk).toEqual(new Set(['expr1', 'expr2']));
  });

  it('nodes map and getAncestors are consistent with each other', () => {
    const nodes = [
      makeNode({ id: 'doc',   type: 'document' }),
      makeNode({ id: 'chunk', type: 'chunk', parent_id: 'doc' }),
      makeNode({ id: 'expr',  type: 'expression', parent_id: 'chunk' }),
    ];
    dataStore.getState().load(makeManifest(nodes));
    const { nodes: nodesById } = dataStore.getState();

    const ancestors = getAncestors(nodesById, 'expr');
    expect(ancestors.map((n) => n.id)).toEqual(['chunk', 'doc']);
    expect(ancestors.map((n) => n.type)).toEqual(['chunk', 'document']);
  });
});
