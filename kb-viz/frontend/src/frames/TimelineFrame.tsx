import { useEffect, useMemo, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { projectTimeline } from '../projection/projectors/timeline';

interface Datum {
  id: string;
  date: Date;
  type: string;
  selected: boolean;
  jitter: number;
}

export function TimelineFrame() {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const byType = useStore(dataStore, (s) => s.byType);
  const level = useStore(viewStore, (s) => s.level);
  const selected = useStore(selectionStore, (s) => s.selected);
  const ref = useRef<HTMLDivElement>(null);

  const data = useMemo<Datum[]>(() => {
    const ids = byType.get(level) ?? [];
    const ns = ids.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectTimeline(ns, nodesById);
    return Array.from(positions.entries()).map(([id, p], i) => {
      const node = nodesById.get(id);
      return {
        id,
        date: new Date(p[0]),
        type: node?.type ?? 'unknown',
        selected: selected.has(id),
        // Stable jitter from id hash so points don't jump on every render
        jitter: hashId(id),
      };
    });
  }, [nodesById, byType, level, selected]);

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
    const width = el.clientWidth;
    const height = el.clientHeight;
    const plot = Plot.plot({
      style: { background: 'transparent', color: '#e5e7eb', fontSize: '11px' },
      width,
      height,
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
          // Plot accepts functions at runtime; types are incomplete
          r: ((d: Datum) => (d.selected ? 8 : 5)) as unknown as number,
          fill: ((d: Datum) => (d.selected ? '#f05028' : '#a78bfa')) as unknown as string,
          stroke: 'white',
          strokeOpacity: 0.3,
          title: (d: Datum) => `${d.id}\n${d.date.toISOString().slice(0, 10)}`,
        }),
      ],
    });
    // Plot doesn't natively expose click->datum; attach via DOM order which matches data order.
    plot.querySelectorAll('circle').forEach((circle, i) => {
      const item = data[i];
      if (!item) return;
      (circle as SVGElement).style.cursor = 'pointer';
      circle.addEventListener('click', () =>
        selectionStore.getState().selectOnly(item.id),
      );
    });
    el.appendChild(plot);
    return () => {
      plot.remove();
    };
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
