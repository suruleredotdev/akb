export interface GraphLayoutRequest {
  nodes: { id: string }[];
  edges: { source: string; target: string; weight?: number }[];
}

export interface GraphLayoutResponse {
  type: 'result';
  positions: Record<string, [number, number]>;
}

// Hash string → float in (0,1) for reproducible seeded positions
function hashFloat(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Fruchterman-Reingold spring/repulsion layout
function fruchtermanReingold(
  ids: string[],
  adj: Map<string, Set<string>>,
  iterations = 120,
): Record<string, [number, number]> {
  const n = ids.length;
  if (n === 0) return {};
  if (n === 1) return { [ids[0]]: [0, 0] };

  const W = 1, H = 1;
  const k = Math.sqrt((W * H) / n);
  const repulse = (d: number) => (k * k) / Math.max(d, 0.001);
  const attract = (d: number) => (d * d) / k;

  // Seeded initial positions in [0.1, 0.9]
  const pos: Record<string, [number, number]> = {};
  const disp: Record<string, [number, number]> = {};
  for (const id of ids) {
    pos[id] = [0.1 + hashFloat(id, 1) * 0.8, 0.1 + hashFloat(id, 2) * 0.8];
    disp[id] = [0, 0];
  }

  let temp = 0.1 * W;
  const cool = temp / (iterations + 1);

  for (let iter = 0; iter < iterations; iter++) {
    for (const id of ids) disp[id] = [0, 0];

    // Repulsion between all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const u = ids[i], v = ids[j];
        const dx = pos[u][0] - pos[v][0];
        const dy = pos[u][1] - pos[v][1];
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const f = repulse(dist) / dist;
        disp[u][0] += dx * f; disp[u][1] += dy * f;
        disp[v][0] -= dx * f; disp[v][1] -= dy * f;
      }
    }

    // Attraction along edges
    for (const [u, neighbors] of adj) {
      for (const v of neighbors) {
        const dx = pos[u][0] - pos[v][0];
        const dy = pos[u][1] - pos[v][1];
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const f = attract(dist) / dist;
        disp[u][0] -= dx * f; disp[u][1] -= dy * f;
        disp[v][0] += dx * f; disp[v][1] += dy * f;
      }
    }

    // Limit by temperature and keep in bounds
    for (const id of ids) {
      const d = disp[id];
      const dl = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1;
      const clamped = Math.min(dl, temp) / dl;
      pos[id][0] = Math.max(0.02, Math.min(0.98, pos[id][0] + d[0] * clamped));
      pos[id][1] = Math.max(0.02, Math.min(0.98, pos[id][1] + d[1] * clamped));
    }
    temp -= cool;
  }

  return pos;
}

self.onmessage = (event: MessageEvent<GraphLayoutRequest>) => {
  const { nodes, edges } = event.data;
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);

  // Build undirected adjacency (only edges where both endpoints in scope)
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
  }

  const positions = fruchtermanReingold(ids, adj);
  self.postMessage({ type: 'result', positions } satisfies GraphLayoutResponse);
};
