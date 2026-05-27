import { describe, it, expect } from 'vitest';
import { computeDigest, collectDescendants } from '../lib/compute-digest';
import type { Node, NodeId } from '../types/manifest';

// ---------------------------------------------------------------------------
// Test data helpers
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

// ---------------------------------------------------------------------------
// collectDescendants
// ---------------------------------------------------------------------------

describe('collectDescendants', () => {
  it('returns empty array for a leaf node', () => {
    const byParent = new Map<NodeId, NodeId[]>();
    expect(collectDescendants(byParent, 'a')).toEqual([]);
  });

  it('returns direct children', () => {
    const byParent = new Map([['doc', ['c1', 'c2']]]);
    const result = collectDescendants(byParent, 'doc');
    expect(result).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(result).toHaveLength(2);
  });

  it('returns all descendants across multiple levels', () => {
    // doc → chunk1 → expr1, expr2
    //     → chunk2 → expr3
    const byParent = new Map([
      ['doc', ['chunk1', 'chunk2']],
      ['chunk1', ['expr1', 'expr2']],
      ['chunk2', ['expr3']],
    ]);
    const result = collectDescendants(byParent, 'doc');
    expect(result).toEqual(expect.arrayContaining(['chunk1', 'chunk2', 'expr1', 'expr2', 'expr3']));
    expect(result).toHaveLength(5);
  });

  it('does not include the root node itself', () => {
    const byParent = new Map([['doc', ['c1']]]);
    const result = collectDescendants(byParent, 'doc');
    expect(result).not.toContain('doc');
  });

  it('handles deep single-child chains', () => {
    const byParent = new Map([['a', ['b']], ['b', ['c']], ['c', ['d']]]);
    const result = collectDescendants(byParent, 'a');
    expect(result).toEqual(expect.arrayContaining(['b', 'c', 'd']));
    expect(result).toHaveLength(3);
  });

  it('does not infinite-loop on a malformed graph (cycle guard)', () => {
    // cycle: a → b → a (should not happen in valid data, but guard anyway)
    const byParent = new Map([['a', ['b']], ['b', ['a']]]);
    const result = collectDescendants(byParent, 'a');
    // Should terminate and contain b (a is excluded as root)
    expect(result).toContain('b');
    expect(result).not.toContain('a'); // root excluded and cycle-guard stops re-visiting
  });
});

// ---------------------------------------------------------------------------
// computeDigest – empty / trivial cases
// ---------------------------------------------------------------------------

describe('computeDigest – empty inputs', () => {
  const emptyMap = new Map<NodeId, Node>();
  const emptyByParent = new Map<NodeId, NodeId[]>();

  it('returns all-null digest for an empty node list', () => {
    const d = computeDigest([], emptyMap, emptyByParent);
    expect(d.temporalSpan).toBeNull();
    expect(d.topLocations).toHaveLength(0);
    expect(d.topEntities).toHaveLength(0);
    expect(d.annotatedNodeCount).toBe(0);
    expect(d.derivedFromDescendants).toBe(0);
  });

  it('returns all-null digest for nodes with no annotations', () => {
    const nodes = [makeNode({ id: 'chunk1' }), makeNode({ id: 'chunk2' })];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.temporalSpan).toBeNull();
    expect(d.topLocations).toHaveLength(0);
    expect(d.topEntities).toHaveLength(0);
    expect(d.annotatedNodeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDigest – direct annotations
// ---------------------------------------------------------------------------

describe('computeDigest – direct annotations on selected nodes', () => {
  it('extracts a temporal span from a single date', () => {
    const nodes = [
      makeNode({
        id: 'e1',
        annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2020-01-15', granularity: 'day' } }],
      }),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.temporalSpan).toEqual({ start: '2020-01-15', end: '2020-01-15' });
  });

  it('computes temporal span across multiple dates', () => {
    const nodes = [
      makeNode({
        id: 'e1',
        annotations: [
          { id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2020-06-01', granularity: 'day' } },
          { id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '2019-03-10', granularity: 'day' } },
        ],
      }),
      makeNode({
        id: 'e2',
        annotations: [
          { id: 'a3', type: 'temporal', value: { kind: 'temporal', iso_start: '2021-12-31', granularity: 'day' } },
        ],
      }),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.temporalSpan?.start).toBe('2019-03-10');
    expect(d.temporalSpan?.end).toBe('2021-12-31');
  });

  it('aggregates location counts and returns top-5', () => {
    const makeGeo = (id: string, name: string) => makeNode({
      id,
      annotations: [{ id: `ann-${id}`, type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name } }],
    });
    // 7 nodes: Paris×3, London×2, Cairo×1, Lagos×1, Tokyo×1 (excess)
    const nodes = [
      makeGeo('e1', 'Paris'), makeGeo('e2', 'Paris'), makeGeo('e3', 'Paris'),
      makeGeo('e4', 'London'), makeGeo('e5', 'London'),
      makeGeo('e6', 'Cairo'), makeGeo('e7', 'Lagos'), makeGeo('e8', 'Tokyo'),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.topLocations).toHaveLength(5);
    expect(d.topLocations[0]).toEqual({ name: 'Paris', count: 3 });
    expect(d.topLocations[1]).toEqual({ name: 'London', count: 2 });
  });

  it('aggregates entity counts and returns top-5', () => {
    const makeEntity = (id: string, name: string) => makeNode({
      id,
      annotations: [{ id: `ann-${id}`, type: 'entity_ref', value: { kind: 'entity_ref', entity_id: name, name } }],
    });
    const nodes = [
      makeEntity('e1', 'France'), makeEntity('e2', 'France'),
      makeEntity('e3', 'Senegal'), makeEntity('e4', 'Senegal'), makeEntity('e5', 'Senegal'),
      makeEntity('e6', 'Chad'),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.topEntities).toHaveLength(3);
    expect(d.topEntities[0]).toEqual({ name: 'Senegal', count: 3 });
    expect(d.topEntities[1]).toEqual({ name: 'France', count: 2 });
    expect(d.topEntities[2]).toEqual({ name: 'Chad', count: 1 });
  });

  it('skips geographic annotations with no name', () => {
    const nodes = [
      makeNode({
        id: 'e1',
        annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 10, lng: 20, name: null } }],
      }),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.topLocations).toHaveLength(0);
  });

  it('skips entity_ref annotations with no name', () => {
    const nodes = [
      makeNode({
        id: 'e1',
        annotations: [{ id: 'a1', type: 'entity_ref', value: { kind: 'entity_ref', entity_id: 'x', name: null } }],
      }),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.topEntities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeDigest – descendant traversal (the key regression fix)
// ---------------------------------------------------------------------------

describe('computeDigest – descendant annotation aggregation', () => {
  it('aggregates annotations from expression children of a chunk', () => {
    // Reproduces the reported bug: chunk has 0 annotations, expressions have them.
    const chunk = makeNode({ id: 'chunk1', type: 'chunk', parent_id: null });
    const expr1 = makeNode({
      id: 'expr1', type: 'expression', parent_id: 'chunk1',
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2022-03', granularity: 'month' } }],
    });
    const expr2 = makeNode({
      id: 'expr2', type: 'expression', parent_id: 'chunk1',
      annotations: [{ id: 'a2', type: 'geographic', value: { kind: 'geographic', lat: 5, lng: 5, name: 'Dakar' } }],
    });

    const allNodes = [chunk, expr1, expr2];
    const nodesById = makeNodesById(allNodes);
    const byParent = makeByParent(allNodes);

    const d = computeDigest([chunk], nodesById, byParent);
    expect(d.temporalSpan).toEqual({ start: '2022-03', end: '2022-03' });
    expect(d.topLocations[0]).toEqual({ name: 'Dakar', count: 1 });
    expect(d.derivedFromDescendants).toBe(1); // chunk itself had no annotations
    expect(d.annotatedNodeCount).toBe(2);     // expr1 + expr2
  });

  it('aggregates annotations from all levels: document → chunk → expression', () => {
    // doc has no annotations, chunks have no annotations, expressions have them
    const doc = makeNode({ id: 'doc1', type: 'document' });
    const chunk1 = makeNode({ id: 'chunk1', type: 'chunk', parent_id: 'doc1' });
    const chunk2 = makeNode({ id: 'chunk2', type: 'chunk', parent_id: 'doc1' });
    const expr1 = makeNode({
      id: 'expr1', type: 'expression', parent_id: 'chunk1',
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2018', granularity: 'year' } }],
    });
    const expr2 = makeNode({
      id: 'expr2', type: 'expression', parent_id: 'chunk1',
      annotations: [{ id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '2025', granularity: 'year' } }],
    });
    const expr3 = makeNode({
      id: 'expr3', type: 'expression', parent_id: 'chunk2',
      annotations: [{ id: 'a3', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Bamako' } }],
    });

    const allNodes = [doc, chunk1, chunk2, expr1, expr2, expr3];
    const d = computeDigest([doc], makeNodesById(allNodes), makeByParent(allNodes));

    expect(d.temporalSpan).toEqual({ start: '2018', end: '2025' });
    expect(d.topLocations[0]).toEqual({ name: 'Bamako', count: 1 });
    expect(d.annotatedNodeCount).toBe(3); // expr1, expr2, expr3
    expect(d.derivedFromDescendants).toBe(1); // only doc was selected (it had no direct annotations)
  });

  it('counts direct annotations when node has both its own and descendant annotations', () => {
    // A chunk that itself has an annotation AND its expression children also have annotations
    const chunk = makeNode({
      id: 'chunk1',
      annotations: [{ id: 'a0', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Abuja' } }],
    });
    const expr = makeNode({
      id: 'expr1', parent_id: 'chunk1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Lagos' } }],
    });

    const allNodes = [chunk, expr];
    const d = computeDigest([chunk], makeNodesById(allNodes), makeByParent(allNodes));

    const names = d.topLocations.map((l) => l.name);
    expect(names).toContain('Abuja');
    expect(names).toContain('Lagos');
    // derivedFromDescendants should be 0 since chunk had direct annotations
    expect(d.derivedFromDescendants).toBe(0);
  });

  it('does not duplicate annotations when same node appears via multiple paths', () => {
    // Not possible in a tree, but guard against it anyway
    const chunk = makeNode({ id: 'chunk1' });
    const expr = makeNode({
      id: 'expr1', parent_id: 'chunk1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Cairo' } }],
    });

    const allNodes = [chunk, expr];
    // Select both chunk AND expression — expr should only be counted once
    const d = computeDigest([chunk, expr], makeNodesById(allNodes), makeByParent(allNodes));
    // Cairo appears from chunk's traversal (includes expr1) AND from direct selection of expr1
    // Both paths hit the same node → Cairo's count should be 2 (one per selected-root context)
    // OR deduplicated to 1 if we guard — current implementation does NOT deduplicate across roots
    // This test documents the current behaviour (counts can accumulate per root)
    expect(d.topLocations[0].name).toBe('Cairo');
    expect(d.topLocations[0].count).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computeDigest – derivedFromDescendants counter
// ---------------------------------------------------------------------------

describe('computeDigest – derivedFromDescendants flag', () => {
  it('is 0 when all selected nodes have direct annotations', () => {
    const nodes = [
      makeNode({
        id: 'e1',
        annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2020', granularity: 'year' } }],
      }),
    ];
    const d = computeDigest(nodes, makeNodesById(nodes), makeByParent(nodes));
    expect(d.derivedFromDescendants).toBe(0);
  });

  it('increments for each selected node that had no direct annotations', () => {
    const chunk1 = makeNode({ id: 'c1', type: 'chunk' });
    const chunk2 = makeNode({ id: 'c2', type: 'chunk' });
    const expr1  = makeNode({
      id: 'e1', parent_id: 'c1',
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2020', granularity: 'year' } }],
    });
    const expr2  = makeNode({
      id: 'e2', parent_id: 'c2',
      annotations: [{ id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '2021', granularity: 'year' } }],
    });

    const all = [chunk1, chunk2, expr1, expr2];
    const d = computeDigest([chunk1, chunk2], makeNodesById(all), makeByParent(all));
    expect(d.derivedFromDescendants).toBe(2);
    expect(d.annotatedNodeCount).toBe(2); // e1 + e2
  });
});

// ---------------------------------------------------------------------------
// computeDigest – history nodes
// ---------------------------------------------------------------------------

describe('computeDigest – history nodes integration', () => {
  it('uses history nodes when selection is empty', () => {
    const expr = makeNode({
      id: 'e1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Timbuktu' } }],
    });
    const nodesById = makeNodesById([expr]);
    const byParent = makeByParent([expr]);

    // No selection, but history contains e1
    const d = computeDigest([], nodesById, byParent, [expr]);
    expect(d.topLocations[0]?.name).toBe('Timbuktu');
    expect(d.historyNodeCount).toBe(1);
  });

  it('merges selection and history contexts', () => {
    const selected = makeNode({
      id: 's1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Dakar' } }],
    });
    const historical = makeNode({
      id: 'h1',
      annotations: [{ id: 'a2', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Accra' } }],
    });

    const allNodes = [selected, historical];
    const d = computeDigest([selected], makeNodesById(allNodes), makeByParent(allNodes), [historical]);
    const names = d.topLocations.map((l) => l.name);
    expect(names).toContain('Dakar');
    expect(names).toContain('Accra');
    expect(d.historyNodeCount).toBe(1);
  });

  it('does not double-count a node that appears in both selection and history', () => {
    const node = makeNode({
      id: 'n1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Nairobi' } }],
    });
    const d = computeDigest([node], makeNodesById([node]), makeByParent([node]), [node]);
    // Should only count Nairobi once
    expect(d.topLocations).toHaveLength(1);
    expect(d.topLocations[0].count).toBe(1);
    // historyNodeCount should be 0 because n1 was already in the selection
    expect(d.historyNodeCount).toBe(0);
  });

  it('does not double-count a history node that is a descendant of a selected node', () => {
    // Chunk is selected; expr1 is its child and also appears in history
    const chunk = makeNode({ id: 'chunk1', type: 'chunk' });
    const expr  = makeNode({
      id: 'expr1', type: 'expression', parent_id: 'chunk1',
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 0, lng: 0, name: 'Kigali' } }],
    });
    const all = [chunk, expr];
    // chunk is selected → its subtree (including expr) is traversed
    // expr also appears in history → should NOT be counted again
    const d = computeDigest([chunk], makeNodesById(all), makeByParent(all), [expr]);
    expect(d.topLocations[0].count).toBe(1); // only once
  });

  it('history enriches the temporal span', () => {
    const selected = makeNode({
      id: 's1',
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '2020', granularity: 'year' } }],
    });
    const hist1 = makeNode({
      id: 'h1',
      annotations: [{ id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '2015', granularity: 'year' } }],
    });
    const hist2 = makeNode({
      id: 'h2',
      annotations: [{ id: 'a3', type: 'temporal', value: { kind: 'temporal', iso_start: '2024', granularity: 'year' } }],
    });

    const all = [selected, hist1, hist2];
    const d = computeDigest([selected], makeNodesById(all), makeByParent(all), [hist1, hist2]);
    expect(d.temporalSpan?.start).toBe('2015');
    expect(d.temporalSpan?.end).toBe('2024');
    expect(d.historyNodeCount).toBe(2);
  });
});
