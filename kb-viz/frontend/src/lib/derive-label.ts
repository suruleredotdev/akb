import type { Node } from '../types/manifest';

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const cut = str.lastIndexOf(' ', maxLen);
  return str.slice(0, cut > 0 ? cut : maxLen) + '…';
}

export function deriveLabel(node: Node, maxLen = 80): string {
  const title = node.properties['title'];
  if (title?.kind === 'categorical') return truncate(title.value, maxLen);

  // 'label' is used by document nodes (and other top-level types without a title)
  const label = node.properties['label'];
  if (label?.kind === 'categorical') return truncate(label.value, maxLen);

  const source = node.properties['source'];
  if (source?.kind === 'categorical') {
    // Show just the filename, not a full path/URL
    const parts = source.value.replace(/\\/g, '/').split('/');
    return truncate(parts[parts.length - 1] ?? source.value, maxLen);
  }

  if (node.text) {
    const trimmed = node.text.trim().replace(/\s+/g, ' ');
    return truncate(trimmed, maxLen);
  }

  return node.id;
}
