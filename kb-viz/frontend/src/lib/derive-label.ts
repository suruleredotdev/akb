import type { Node } from '../types/manifest';

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const cut = str.lastIndexOf(' ', maxLen);
  return str.slice(0, cut > 0 ? cut : maxLen) + '…';
}

function rawLabel(node: Node, maxLen: number): string {
  const title = node.properties['title'];
  if (title?.kind === 'categorical') return truncate(title.value, maxLen);

  const label = node.properties['label'];
  if (label?.kind === 'categorical') return truncate(label.value, maxLen);

  const source = node.properties['source'];
  if (source?.kind === 'categorical') {
    const parts = source.value.replace(/\\/g, '/').split('/');
    return truncate(parts[parts.length - 1] ?? source.value, maxLen);
  }

  if (node.text) return truncate(node.text.trim().replace(/\s+/g, ' '), maxLen);

  return node.id;
}

/**
 * Derive a display label for a node.
 *
 * When `nodesById` is provided and the node has a parent (i.e. it is a chunk
 * or expression), the label is prefixed with a short parent title so the
 * canvas label carries document context: "Parent title · chunk text…"
 */
export function deriveLabel(
  node: Node,
  maxLen = 80,
  nodesById?: Map<string, Node>,
): string {
  if (nodesById && node.parent_id) {
    const parent = nodesById.get(node.parent_id);
    if (parent) {
      const parentPrefix = rawLabel(parent, 10);
      return `${parentPrefix} · ${rawLabel(node, maxLen)}`;
    }
  }
  return rawLabel(node, maxLen);
}
