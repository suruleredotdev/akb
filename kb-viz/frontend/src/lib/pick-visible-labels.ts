/**
 * Grid-based spatial thinning: returns a Set of item IDs that should show labels.
 * Divides the data extent into a grid of `divisions × divisions` cells and keeps
 * at most one label per cell. As `divisions` increases (e.g. with zoom), more labels
 * are revealed — giving progressive disclosure without overlap.
 */
export function pickVisibleLabels<T extends { id: string }>(
  items: T[],
  getXY: (item: T) => [number, number],
  divisions: number,
): Set<string> {
  if (items.length === 0) return new Set();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of items) {
    const [x, y] = getXY(item);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const cellW = (maxX - minX) / divisions || 1;
  const cellH = (maxY - minY) / divisions || 1;
  const occupied = new Set<string>();
  const result = new Set<string>();

  for (const item of items) {
    const [x, y] = getXY(item);
    const key = `${Math.floor((x - minX) / cellW)},${Math.floor((y - minY) / cellH)}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      result.add(item.id);
    }
  }

  return result;
}
