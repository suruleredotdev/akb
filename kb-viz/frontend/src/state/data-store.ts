import { createStore } from 'zustand/vanilla';
import type { Manifest, Node, NodeId, Edge } from '../types/manifest';

export interface DataState {
  schemaId: string;
  manifest: Manifest | null;
  nodes: Map<NodeId, Node>;
  edges: Map<string, Edge>;
  byType: Map<string, NodeId[]>;
  byParent: Map<NodeId, NodeId[]>;
  load: (m: Manifest) => void;
}

export const dataStore = createStore<DataState>((set) => ({
  schemaId: '',
  manifest: null,
  nodes: new Map(),
  edges: new Map(),
  byType: new Map(),
  byParent: new Map(),
  load: (m) => {
    const nodes = new Map<NodeId, Node>();
    const byType = new Map<string, NodeId[]>();
    const byParent = new Map<NodeId, NodeId[]>();
    for (const n of m.nodes) {
      nodes.set(n.id, n);
      const tarr = byType.get(n.type) ?? [];
      tarr.push(n.id);
      byType.set(n.type, tarr);
      if (n.parent_id) {
        const parr = byParent.get(n.parent_id) ?? [];
        parr.push(n.id);
        byParent.set(n.parent_id, parr);
      }
    }
    const edges = new Map(m.edges.map((e) => [e.id, e] as const));
    set({
      schemaId: m.schema_id,
      manifest: m,
      nodes,
      edges,
      byType,
      byParent,
    });
  },
}));
