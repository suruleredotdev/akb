import { describe, it, expect } from 'vitest';
import { projectSemantic } from '../../projection/projectors/semantic';
import type { Node } from '../../types/manifest';

const node = (id: string, embedding: number[]): Node => ({
  id, type: 'chunk', child_ids: [], properties: {}, annotations: [], embedding,
});

describe('projectSemantic', () => {
  it('returns empty map when no nodes have embeddings', () => {
    const n = node('n1', []);
    expect(projectSemantic([n]).size).toBe(0);
  });

  it('returns single point at origin for one node', () => {
    const n = node('n1', [1, 0, 0]);
    const result = projectSemantic([n]);
    expect(result.get('n1')).toEqual([0, 0]);
  });

  it('returns two symmetric points for two nodes', () => {
    const n1 = node('n1', [1, 0]);
    const n2 = node('n2', [0, 1]);
    const result = projectSemantic([n1, n2]);
    const p1 = result.get('n1')!;
    const p2 = result.get('n2')!;
    expect(Math.abs(p1[0] + p2[0])).toBeLessThan(0.01); // symmetric around 0
  });

  it('is deterministic across calls with same input', () => {
    const nodes = [
      node('a', [1, 0, 0]),
      node('b', [0, 1, 0]),
      node('c', [0, 0, 1]),
      node('d', [1, 1, 0]),
    ];
    const r1 = projectSemantic(nodes);
    const r2 = projectSemantic(nodes);
    for (const [id, pos] of r1) {
      expect(r2.get(id)).toEqual(pos);
    }
  });

  it('returns a position for every node with an embedding', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      node(`n${i}`, [Math.cos(i), Math.sin(i)]),
    );
    const result = projectSemantic(nodes);
    expect(result.size).toBe(5);
  });
});
