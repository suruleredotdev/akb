import { isTemporal, type Node, type NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

/**
 * For each node, find a timestamp (ms since epoch) by:
 *   1. Direct temporal annotation
 *   2. summary.frame_summaries.timeline.centroid (in seconds, converted to ms)
 *   3. Mean of descendant temporal annotations
 */
export function projectTimeline(
  nodes: Node[],
  allNodes: Map<NodeId, Node>,
): ProjectionResult {
  const result = new Map<NodeId, Coords>();
  for (const n of nodes) {
    const t = findTime(n, allNodes);
    if (t !== null) result.set(n.id, [t]);
  }
  return result;
}

function findTime(node: Node, all: Map<NodeId, Node>): number | null {
  for (const a of node.annotations) {
    if (isTemporal(a.value)) {
      const t = Date.parse(a.value.iso_start);
      if (!Number.isNaN(t)) return t;
    }
  }
  const c = node.summary?.frame_summaries?.timeline?.centroid;
  if (c && c.length >= 1) return c[0] * 1000; // adapter writes seconds; we want ms
  const times: number[] = [];
  walkTime(node, all, times);
  if (times.length === 0) return null;
  return times.reduce((s, x) => s + x, 0) / times.length;
}

function walkTime(node: Node, all: Map<NodeId, Node>, out: number[]): void {
  for (const a of node.annotations) {
    if (isTemporal(a.value)) {
      const t = Date.parse(a.value.iso_start);
      if (!Number.isNaN(t)) out.push(t);
    }
  }
  for (const cid of node.child_ids) {
    const c = all.get(cid);
    if (c) walkTime(c, all, out);
  }
}
