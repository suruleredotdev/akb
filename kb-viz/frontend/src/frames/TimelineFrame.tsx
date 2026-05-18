import { useEffect, useMemo, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder, rgbaToHex } from '../lib/color-encoder';
import { projectTimeline } from '../projection/projectors/timeline';

interface Datum {
  id: string;
  date: Date;
  color: string;
  selected: boolean;
  jitter: number;
}

import type { FrameProps } from './registry';
export function TimelineFrame({ width, height }: FrameProps) {
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
    const ns = scopedIds.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectTimeline(ns, nodesById);
    return Array.from(positions.entries()).map(([id, p]) => ({
      id,
      date: new Date(p[0]),
      color: rgbaToHex(encode(id, selected.has(id))),
      selected: selected.has(id),
      jitter: hashId(id),
    }));
  }, [nodesById, scopedIds, encode, selected]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    if (data.length === 0) {
      const div = document.createElement('div');
      div.className = 'frame-empty';
      div.textContent = `No temporal data at level "${level}"`;
      el.appendChild(div);
      return;
    }
    const w = width || el.clientWidth;
    const h = height || el.clientHeight;
    const plot = Plot.plot({
      style: { background: 'transparent', color: '#e5e7eb', fontSize: '11px' },
      width: w,
      height: h,
      marginTop: 36,
      marginBottom: 32,
      marginLeft: 16,
      marginRight: 16,
      x: { type: 'utc', label: null, grid: true },
      y: { axis: null, domain: [0, 1] },
      marks: [
        Plot.dot(data, {
          x: 'date',
          y: 'jitter',
          r: ((d: Datum) => (d.selected ? 8 : 5)) as unknown as number,
          fill: 'color',
          stroke: 'white',
          strokeOpacity: 0.3,
          title: (d: Datum) => `${d.id}\n${d.date.toISOString().slice(0, 10)}`,
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

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 0.2 + (((h >>> 0) % 1000) / 1000) * 0.6;
}
