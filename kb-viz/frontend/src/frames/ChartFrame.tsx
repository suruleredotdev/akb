import { useEffect, useMemo, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder, rgbaToHex } from '../lib/color-encoder';
import { getScalar } from '../types/manifest';

interface Datum {
  id: string;
  x: number;
  y: number;
  color: string;
  selected: boolean;
}

export function ChartFrame() {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const nodeTypes = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level = useStore(viewStore, (s) => s.level);
  const colorBy = useStore(viewStore, (s) => s.colorBy);
  const selected = useStore(selectionStore, (s) => s.selected);
  const scopedIds = useScopedIds(level);
  const ref = useRef<HTMLDivElement>(null);

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const data = useMemo<Datum[]>(() => {
    const out: Datum[] = [];
    for (const id of scopedIds) {
      const n = nodesById.get(id);
      if (!n) continue;
      const x = getScalar(n, 'position') ?? getScalar(n, 'chunk_index');
      const y = getScalar(n, 'length') ?? getScalar(n, 'chunk_count');
      if (x !== undefined && y !== undefined) {
        out.push({
          id,
          x,
          y,
          color: rgbaToHex(encode(id, selected.has(id))),
          selected: selected.has(id),
        });
      }
    }
    return out;
  }, [nodesById, scopedIds, encode, selected]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    if (data.length === 0) {
      const div = document.createElement('div');
      div.className = 'frame-empty';
      div.textContent = `No length/position data at level "${level}"`;
      el.appendChild(div);
      return;
    }
    const width = el.clientWidth;
    const height = el.clientHeight;
    const allY = data.map((d) => d.y).filter((y) => y > 0);
    const useLog = allY.length > 0 && Math.max(...allY) / Math.max(Math.min(...allY), 1) > 10;
    const plot = Plot.plot({
      style: { background: 'transparent', color: '#e5e7eb', fontSize: '11px' },
      width,
      height,
      marginTop: 36,
      marginBottom: 36,
      marginLeft: 48,
      marginRight: 16,
      x: { label: 'position →', grid: true },
      y: { label: '↑ length', grid: true, type: useLog ? 'log' : 'linear' },
      marks: [
        Plot.dot(data, {
          x: 'x',
          y: 'y',
          r: ((d: Datum) => (d.selected ? 8 : 5)) as unknown as number,
          fill: 'color',
          stroke: 'white',
          strokeOpacity: 0.3,
          title: (d: Datum) => `${d.id}\nposition=${d.x.toFixed(2)} length=${d.y}`,
        }),
      ],
    });
    plot.querySelectorAll('circle').forEach((circle, i) => {
      const item = data[i];
      if (!item) return;
      (circle as SVGElement).style.cursor = 'pointer';
      circle.addEventListener('click', () => selectionStore.getState().selectOnly(item.id));
    });
    el.appendChild(plot);
    return () => { plot.remove(); };
  }, [data, level]);

  return <div ref={ref} className="plot-container" />;
}
