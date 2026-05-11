import { isGeographic, type Node, type NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

/**
 * For each node, find a single (lng, lat) coordinate by checking in order:
 *   1. Direct geographic annotation on the node
 *   2. Pre-computed `summary.frame_summaries.map.centroid`
 *   3. Mean of geographic annotations on descendants (recursive)
 * Nodes with no resolvable coordinate are absent from the result.
 */
export function projectMap(
  nodes: Node[],
  allNodes: Map<NodeId, Node>,
): ProjectionResult {
  const result = new Map<NodeId, Coords>();
  for (const n of nodes) {
    const coord = findGeoCoord(n, allNodes);
    if (coord) result.set(n.id, coord);
  }
  return result;
}

function findGeoCoord(node: Node, all: Map<NodeId, Node>): Coords | null {
  for (const a of node.annotations) {
    if (isGeographic(a.value)) return [a.value.lng, a.value.lat];
  }
  const c = node.summary?.frame_summaries?.map?.centroid;
  if (c && c.length >= 2) return [c[0], c[1]];
  const coords: Coords[] = [];
  walk(node, all, coords);
  if (coords.length === 0) return null;
  const lng = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const lat = coords.reduce((s, p) => s + p[1], 0) / coords.length;
  return [lng, lat];
}

function walk(node: Node, all: Map<NodeId, Node>, out: Coords[]): void {
  for (const a of node.annotations) {
    if (isGeographic(a.value)) out.push([a.value.lng, a.value.lat]);
  }
  for (const cid of node.child_ids) {
    const c = all.get(cid);
    if (c) walk(c, all, out);
  }
}
