import { UMAP } from 'umap-js';
import type { Node, NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

// Mulberry32 — small deterministic PRNG so UMAP output is stable between reloads.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function projectSemantic(nodes: Node[]): ProjectionResult {
  const withEmb = nodes.filter(
    (n): n is Node & { embedding: number[] } =>
      Array.isArray(n.embedding) && n.embedding.length > 0,
  );
  if (withEmb.length === 0) return new Map();
  if (withEmb.length === 1) return new Map([[withEmb[0].id, [0, 0]]]);
  if (withEmb.length === 2) {
    return new Map([
      [withEmb[0].id, [-1, 0]],
      [withEmb[1].id, [1, 0]],
    ]);
  }

  const matrix = withEmb.map((n) => n.embedding);
  const nNeighbors = Math.min(15, Math.max(2, withEmb.length - 1));
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    random: seeded(42),
  });
  const embedding = umap.fit(matrix);

  const result = new Map<NodeId, Coords>();
  withEmb.forEach((n, i) => {
    result.set(n.id, [embedding[i][0], embedding[i][1]]);
  });
  return result;
}
