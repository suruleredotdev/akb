import { useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, LineLayer, TextLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder } from '../lib/color-encoder';
import { getScalar } from '../types/manifest';
import { useBoxSelect, BoxSelectOverlay } from '../lib/use-box-select';
import type { FrameProps } from './registry';

interface Point { id: string; x: number; y: number; }

function niceLinear(min: number, max: number, count = 5): number[] {
  const range = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(range / count)));
  const nice = [1, 2, 5, 10].find((m) => (range / (step * m)) <= count) ?? 10;
  const s = step * nice;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max + s * 0.001; v += s) ticks.push(parseFloat(v.toPrecision(10)));
  return ticks;
}

export function ChartFrame({ width: _w, height: _h }: FrameProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const nodeTypes = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level     = useStore(viewStore, (s) => s.level);
  const colorBy   = useStore(viewStore, (s) => s.colorBy);
  const selected  = useStore(selectionStore, (s) => s.selected);
  const hovered   = useStore(selectionStore, (s) => s.hovered);
  const scopedIds = useScopedIds(level);

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const points = useMemo<Point[]>(() => {
    const out: Point[] = [];
    for (const id of scopedIds) {
      const n = nodesById.get(id);
      if (!n) continue;
      const x = getScalar(n, 'position') ?? getScalar(n, 'chunk_index');
      const y = getScalar(n, 'length') ?? getScalar(n, 'chunk_count');
      if (x !== undefined && y !== undefined) out.push({ id, x, y });
    }
    return out;
  }, [nodesById, scopedIds]);

  const { minX, maxX, minY, maxY } = useMemo(() => {
    if (points.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }, [points]);

  const padX = (maxX - minX) * 0.08 || 1;
  const padY = (maxY - minY) * 0.12 || 1;

  const viewState = useMemo(() => ({
    target: [(minX + maxX) / 2, (minY + maxY) / 2, 0] as [number, number, number],
    zoom: Math.log2(Math.min(_w || 800, _h || 600) / Math.max(maxX - minX + padX * 2, maxY - minY + padY * 2, 1)) - 0.5,
  }), [minX, maxX, minY, maxY, padX, padY, _w, _h]);

  const xTicks = useMemo(() => niceLinear(minX, maxX), [minX, maxX]);
  const yTicks = useMemo(() => niceLinear(minY, maxY), [minY, maxY]);

  const getColor = useCallback((d: Point): [number, number, number, number] => {
    if (selected.has(d.id)) return [240, 80, 40, 255];
    if (hovered === d.id)   return [251, 191, 36, 255];
    const [r, g, b, a] = encode(d.id, false);
    return [r, g, b, selected.size > 0 ? 51 : a];
  }, [selected, hovered, encode]);

  const { deckRef, dragRect, onMouseDown } = useBoxSelect<Point>({
    extractId: (obj) => obj?.id,
    onSelect: (ids, shift) => {
      if (shift) selectionStore.getState().addToSelection(ids);
      else selectionStore.getState().boxSelect(ids);
    },
  });

  if (points.length === 0) {
    return (
      <div className="frame-empty">
        <div>No position data at level <strong>{level}</strong></div>
        <div className="frame-empty-hint">
          This chart shows chunk position vs length. Switch to "chunk" level to see nodes plotted here.
        </div>
      </div>
    );
  }

  const axisColor: [number, number, number, number] = [64, 68, 96, 255];
  const labelColor: [number, number, number, number] = [100, 116, 139, 255];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onMouseDown={onMouseDown}>
      {dragRect && <BoxSelectOverlay rect={dragRect} />}
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    <DeckGL
      ref={deckRef as any}
      views={new OrthographicView({ id: 'chart' })}
      initialViewState={viewState}
      controller
      layers={[
        // X axis
        new LineLayer({
          id: 'x-axis',
          data: [{ s: [minX - padX, minY - padY, 0], t: [maxX + padX, minY - padY, 0] }],
          getSourcePosition: (d: { s: number[]; t: number[] }) => d.s as [number, number, number],
          getTargetPosition: (d: { s: number[]; t: number[] }) => d.t as [number, number, number],
          getColor: axisColor,
          getWidth: 1,
          widthUnits: 'pixels',
        }),
        // Y axis
        new LineLayer({
          id: 'y-axis',
          data: [{ s: [minX - padX, minY - padY, 0], t: [minX - padX, maxY + padY, 0] }],
          getSourcePosition: (d: { s: number[]; t: number[] }) => d.s as [number, number, number],
          getTargetPosition: (d: { s: number[]; t: number[] }) => d.t as [number, number, number],
          getColor: axisColor,
          getWidth: 1,
          widthUnits: 'pixels',
        }),
        // X tick labels
        new TextLayer({
          id: 'x-ticks',
          data: xTicks,
          getText: (v: number) => String(v),
          getPosition: (v: number) => [v, minY - padY * 0.6, 0],
          getSize: 10,
          getColor: labelColor,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          fontFamily: 'ui-monospace, monospace',
        }),
        // Y tick labels
        new TextLayer({
          id: 'y-ticks',
          data: yTicks,
          getText: (v: number) => String(v),
          getPosition: (v: number) => [minX - padX * 0.6, v, 0],
          getSize: 10,
          getColor: labelColor,
          getTextAnchor: 'end',
          getAlignmentBaseline: 'center',
          fontFamily: 'ui-monospace, monospace',
        }),
        new ScatterplotLayer<Point>({
          id: 'chart-points',
          data: points,
          getPosition: (d) => [d.x, d.y, 0],
          getRadius: (d) => (selected.has(d.id) ? 7 : hovered === d.id ? 6 : 4),
          getFillColor: getColor,
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: [255, 255, 255, 40],
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 1,
          pickable: true,
          onClick: (info, event) => {
            const id = (info.object as Point | undefined)?.id;
            if (!id) return;
            const shift = (event?.srcEvent as MouseEvent | undefined)?.shiftKey ?? false;
            if (shift) selectionStore.getState().toggle(id);
            else selectionStore.getState().selectOnly(id);
          },
          onHover: (info) => {
            selectionStore.getState().hover((info.object as Point | undefined)?.id ?? null);
          },
          updateTriggers: {
            getFillColor: [selected, hovered, colorBy, nodesById],
            getRadius: [selected, hovered],
          },
          transitions: { getFillColor: 120 },
        }),
      ]}
    />
    </div>
  );
}
