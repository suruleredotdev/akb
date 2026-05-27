import { UMAP } from 'umap-js';

export interface UmapRequest {
  ids: string[];
  embeddings: number[][];
  seed?: number;
  nComponents?: 2 | 3;
}

export interface UmapResponse {
  type: 'result';
  ids: string[];
  coords: number[][];  // [x,y] or [x,y,z] depending on nComponents
}

export interface UmapError {
  type: 'error';
  message: string;
}

// Mulberry32 PRNG — stable output between reloads
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

self.onmessage = (event: MessageEvent<UmapRequest>) => {
  const { ids, embeddings, seed = 42, nComponents = 2 } = event.data;

  try {
    if (embeddings.length === 0) {
      self.postMessage({ type: 'result', ids: [], coords: [] } satisfies UmapResponse);
      return;
    }
    if (embeddings.length === 1) {
      const c = nComponents === 3 ? [[0, 0, 0]] : [[0, 0]];
      self.postMessage({ type: 'result', ids, coords: c } satisfies UmapResponse);
      return;
    }
    if (embeddings.length === 2) {
      const c = nComponents === 3 ? [[-1, 0, 0], [1, 0, 0]] : [[-1, 0], [1, 0]];
      self.postMessage({ type: 'result', ids, coords: c } satisfies UmapResponse);
      return;
    }

    const nNeighbors = Math.min(15, Math.max(2, embeddings.length - 1));
    const umap = new UMAP({ nComponents, nNeighbors, minDist: 0.1, random: seeded(seed) });
    const embedding = umap.fit(embeddings);

    const coords: [number, number][] = embedding.map((row) => [row[0], row[1]]);
    self.postMessage({ type: 'result', ids, coords } satisfies UmapResponse);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err instanceof Error ? err.message : err) } satisfies UmapError);
  }
};
