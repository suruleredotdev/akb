/**
 * computeDigest – pure function, no React dependency.
 *
 * Aggregates temporal, geographic, and entity annotations across a set of
 * nodes **and their entire descendant subtrees**. The nodes are drawn from
 * two sources:
 *
 *  1. `selectedNodes` – the user's current explicit selection (primary)
 *  2. `historyNodes`  – recently visited nodes (secondary, optional)
 *
 * History nodes are merged in so the digest stays populated as you navigate,
 * not only when something is explicitly selected. Selection nodes take
 * precedence in the counts (they are processed first and their subtrees are
 * not double-counted if they also appear in history).
 *
 * In the typical document → chunk → expression hierarchy, annotations live on
 * expression nodes while users often select at the chunk or document level.
 * Walking the descendant tree ensures those annotations are surfaced.
 */

import { isTemporal, isGeographic, isEntityRef } from '../types/manifest';
import type { Node, NodeId } from '../types/manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Digest {
  temporalSpan: { start: string; end: string } | null;
  topLocations: { name: string; count: number }[];
  topEntities:  { name: string; count: number }[];
  /** Total distinct annotated nodes (incl. descendants) that contributed. */
  annotatedNodeCount: number;
  /** Number of source nodes that had no direct annotations; data came from
   *  their descendants. */
  derivedFromDescendants: number;
  /** How many of the source nodes came from the navigation history
   *  (as opposed to the current selection). */
  historyNodeCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all descendant IDs of `rootId` via a BFS over `byParent`.
 * Does NOT include `rootId` itself.
 */
export function collectDescendants(
  byParent: Map<NodeId, NodeId[]>,
  rootId: NodeId,
): NodeId[] {
  const result: NodeId[] = [];
  const queue: NodeId[] = [rootId];
  const seen = new Set<NodeId>();
  seen.add(rootId);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of byParent.get(cur) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        result.push(child);
        queue.push(child);
      }
    }
  }
  return result;
}

/**
 * Accumulate annotations for a single root node + its descendants into the
 * running aggregation state.  `visitedIds` is a global dedup set – any node
 * ID already in it is skipped to avoid double-counting when a subtree was
 * already walked by an earlier root.
 */
function accumulate(
  rootNode: Node,
  nodesById: Map<NodeId, Node>,
  byParent: Map<NodeId, NodeId[]>,
  visitedIds: Set<NodeId>,
  state: {
    dates: string[];
    locCounts: Record<string, number>;
    entityCounts: Record<string, number>;
    annotatedNodeCount: number;
    derivedFromDescendants: number;
  },
): void {
  const idsToCheck: NodeId[] = [rootNode.id, ...collectDescendants(byParent, rootNode.id)];
  const rootHadDirect = rootNode.annotations.length > 0;

  for (const id of idsToCheck) {
    if (visitedIds.has(id)) continue;
    visitedIds.add(id);

    const node = nodesById.get(id);
    if (!node || node.annotations.length === 0) continue;

    state.annotatedNodeCount++;

    for (const a of node.annotations) {
      if (isTemporal(a.value)) {
        state.dates.push(a.value.iso_start);
      }
      if (isGeographic(a.value) && a.value.name) {
        state.locCounts[a.value.name] = (state.locCounts[a.value.name] ?? 0) + 1;
      }
      if (isEntityRef(a.value) && a.value.name) {
        state.entityCounts[a.value.name] = (state.entityCounts[a.value.name] ?? 0) + 1;
      }
    }
  }

  if (!rootHadDirect && idsToCheck.length > 1) {
    state.derivedFromDescendants++;
  }
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function computeDigest(
  selectedNodes: Node[],
  nodesById: Map<NodeId, Node>,
  byParent: Map<NodeId, NodeId[]>,
  /** Recently visited nodes (history). These add context beyond the
   *  current selection. Pass an empty array to disable. */
  historyNodes: Node[] = [],
): Digest {
  const state = {
    dates: [] as string[],
    locCounts: {} as Record<string, number>,
    entityCounts: {} as Record<string, number>,
    annotatedNodeCount: 0,
    derivedFromDescendants: 0,
  };

  // Global dedup set — prevents double-counting when a history node is a
  // descendant of a selected node (or vice-versa).
  const visitedIds = new Set<NodeId>();

  // Selected nodes go first (they represent intentional focus)
  for (const node of selectedNodes) {
    accumulate(node, nodesById, byParent, visitedIds, state);
  }

  // History nodes fill in context when nothing is selected, or broaden it
  const selectedIdSet = new Set(selectedNodes.map((n) => n.id));
  let historyNodeCount = 0;
  for (const node of historyNodes) {
    if (selectedIdSet.has(node.id)) continue; // already processed above
    accumulate(node, nodesById, byParent, visitedIds, state);
    historyNodeCount++;
  }

  const sorted = [...state.dates].sort();
  return {
    temporalSpan:
      sorted.length > 0
        ? { start: sorted[0], end: sorted[sorted.length - 1] }
        : null,
    topLocations: Object.entries(state.locCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    topEntities: Object.entries(state.entityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    annotatedNodeCount: state.annotatedNodeCount,
    derivedFromDescendants: state.derivedFromDescendants,
    historyNodeCount,
  };
}
