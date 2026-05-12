import type { NodeId, NodeType, Node } from '../types/manifest';

export type ColorBy = 'type' | 'document';
export type RGBA = [number, number, number, number];

const SELECTED: RGBA = [240, 80, 40, 255];

// Stable 12-color palette for document assignment
const PALETTE: [number, number, number][] = [
  [99, 102, 241],
  [16, 185, 129],
  [245, 158, 11],
  [239, 68, 68],
  [6, 182, 212],
  [168, 85, 247],
  [249, 115, 22],
  [20, 184, 166],
  [236, 72, 153],
  [132, 204, 22],
  [59, 130, 246],
  [234, 179, 8],
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r || 128, g || 128, b || 128];
}

export function rgbaToHex([r, g, b]: RGBA): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export type ColorEncoder = (id: NodeId, isSelected: boolean) => RGBA;

export function makeColorEncoder(
  nodes: Map<NodeId, Node>,
  nodeTypes: NodeType[],
  colorBy: ColorBy,
): ColorEncoder {
  if (colorBy === 'type') {
    const typeColor = new Map<string, [number, number, number]>(
      nodeTypes.map((nt) => [
        nt.id,
        nt.display.color ? hexToRgb(nt.display.color) : [128, 128, 128],
      ]),
    );
    return (id, sel) => {
      if (sel) return SELECTED;
      const rgb = typeColor.get(nodes.get(id)?.type ?? '') ?? [128, 128, 128];
      return [...rgb, 210] as RGBA;
    };
  }

  // 'document': walk parent chain to find root document, assign palette color by doc index
  const rootCache = new Map<NodeId, NodeId>();
  function rootDoc(id: NodeId): NodeId {
    const hit = rootCache.get(id);
    if (hit !== undefined) return hit;
    const node = nodes.get(id);
    if (!node?.parent_id) { rootCache.set(id, id); return id; }
    const root = rootDoc(node.parent_id);
    rootCache.set(id, root);
    return root;
  }

  const docIds = [...new Set(Array.from(nodes.keys()).map(rootDoc))].sort();
  const docIdx = new Map(docIds.map((d, i) => [d, i]));

  return (id, sel) => {
    if (sel) return SELECTED;
    const rgb = PALETTE[(docIdx.get(rootDoc(id)) ?? 0) % PALETTE.length];
    return [...rgb, 210] as RGBA;
  };
}
