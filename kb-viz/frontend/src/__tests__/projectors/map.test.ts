import { describe, it, expect } from 'vitest';
import { projectMap } from '../../projection/projectors/map';
import type { Node } from '../../types/manifest';

const base = (overrides: Partial<Node>): Node => ({
  id: 'n1', type: 'chunk', child_ids: [], properties: {}, annotations: [], ...overrides,
});

describe('projectMap', () => {
  it('returns empty map when no nodes have geo annotations', () => {
    const node = base({ annotations: [] });
    expect(projectMap([node], new Map([['n1', node]])).size).toBe(0);
  });

  it('picks up direct geographic annotation', () => {
    const node = base({
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 12, lng: 14 } }],
    });
    const result = projectMap([node], new Map([['n1', node]]));
    expect(result.get('n1')).toEqual([14, 12]);
  });

  it('falls back to summary centroid when no direct annotation', () => {
    const node = base({
      annotations: [],
      summary: { descendant_count: 0, child_type_counts: {}, frame_summaries: { map: { count: 1, centroid: [13, 11] } } },
    });
    const result = projectMap([node], new Map([['n1', node]]));
    expect(result.get('n1')).toEqual([13, 11]);
  });

  it('prefers direct annotation over summary centroid', () => {
    const node = base({
      annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 5, lng: 6 } }],
      summary: { descendant_count: 0, child_type_counts: {}, frame_summaries: { map: { count: 1, centroid: [99, 99] } } },
    });
    const result = projectMap([node], new Map([['n1', node]]));
    expect(result.get('n1')).toEqual([6, 5]);
  });

  it('falls back to mean of children when no direct data', () => {
    const child1 = base({ id: 'c1', annotations: [{ id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 10, lng: 20 } }] });
    const child2 = base({ id: 'c2', annotations: [{ id: 'a2', type: 'geographic', value: { kind: 'geographic', lat: 20, lng: 40 } }] });
    const parent = base({ id: 'p1', annotations: [], child_ids: ['c1', 'c2'] });
    const all = new Map([['c1', child1], ['c2', child2], ['p1', parent]]);
    const result = projectMap([parent], all);
    expect(result.get('p1')).toEqual([30, 15]);
  });
});
