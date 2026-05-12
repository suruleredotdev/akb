import { createStore } from 'zustand/vanilla';
import type { Manifest, Node, NodeId, Edge } from '../types/manifest';

export function getDescendants(byParent: Map<NodeId, NodeId[]>, id: NodeId): Set<NodeId> {
  const result = new Set<NodeId>();
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of byParent.get(cur) ?? []) {
      result.add(child);
      queue.push(child);
    }
  }
  return result;
}

export function getAncestors(nodes: Map<NodeId, Node>, id: NodeId): Node[] {
  const result: Node[] = [];
  let parentId = nodes.get(id)?.parent_id;
  while (parentId) {
    const parent = nodes.get(parentId);
    if (!parent) break;
    result.push(parent);
    parentId = parent.parent_id ?? undefined;
  }
  return result;
}

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
