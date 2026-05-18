import type { Node } from '../types/manifest';

export function deriveLabel(node: Node, maxLen = 80): string {
  const title = node.properties['title'];
  if (title?.kind === 'categorical') return title.value;

  const source = node.properties['source'];
  if (source?.kind === 'categorical') {
    // Show just the filename, not a full path/URL
    const parts = source.value.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] ?? source.value;
  }

  if (node.text) {
    const trimmed = node.text.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxLen) return trimmed;
    const cut = trimmed.lastIndexOf(' ', maxLen);
    return trimmed.slice(0, cut > 0 ? cut : maxLen) + '…';
  }

  return node.id;
}
