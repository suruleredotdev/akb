import { useMemo, useState, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, LineLayer, TextLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { filterStore } from '../state/filter-store';
import { makeColorEncoder } from '../lib/color-encoder';
import { projectTimeline } from '../projection/projectors/timeline';
import { deriveLabel } from '../lib/derive-label';
import type { FrameProps } from './registry';

interface Point { id: string; x: number; y: number; }

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.15 + (((h >>> 0) % 1000) / 1000) * 0.7;
}

function yearTicks(minMs: number, maxMs: number): { x: number; label: string }[] {
  const minYear = new Date(minMs).getUTCFullYear();
  const maxYear = new Date(maxMs).getUTCFullYear();
  const span = maxYear - minYear;
  const step = span <= 10 ? 1 : span <= 50 ? 5 : span <= 200 ? 20 : 50;
  const ticks = [];
  for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) {
    ticks.push({ x: Date.UTC(y, 0, 1), label: String(y) });
  }
  return ticks;
}

export function TimelineFrame({ width: _w, height: _h }: FrameProps) {
  const nodesById   = useStore(dataStore, (s) => s.nodes);
  const nodeTypes   = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level       = useStore(viewStore, (s) => s.level);
  const colorBy     = useStore(viewStore, (s) => s.colorBy);
  const selected    = useStore(selectionStore, (s) => s.selected);
  const hovered     = useStore(selectionStore, (s) => s.hovered);
  const scopedIds   = useScopedIds(level);
  const dateRange   = useStore(filterStore, (s) => s.dateRange);

  // Brush state: [startX, endX] in data space (ms) + whether shift was held at drag start
  const [brush, setBrush] = useState<[number, number] | null>(null);
  const brushShiftRef = useRef(false);
  const [zoom, setZoom] = useState<number | null>(null);
  // Store the initial zoom so we can use it as a relative threshold
  const initialZoomRef = useRef<number | null>(null);

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const points = useMemo<Point[]>(() => {
    const ns = scopedIds.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectTimeline(ns, nodesById);
    return Array.from(positions.entries()).map(([id, p]) => ({
      id, x: p[0], y: hashId(id),
    }));
  }, [nodesById, scopedIds]);

  const { minX, maxX } = useMemo(() => {
    if (points.length === 0) return { minX: 0, maxX: 1 };
    const xs = points.map((p) => p.x);
    return { minX: Math.min(...xs), maxX: Math.max(...xs) };
  }, [points]);

  const ticks = useMemo(() => yearTicks(minX, maxX), [minX, maxX]);

  const padding = (maxX - minX) * 0.05 || 1e9;
  const viewState = useMemo(() => ({
    target: [(minX + maxX) / 2, 0.5, 0] as [number, number, number],
    zoom: Math.log2((_w || 800) / ((maxX - minX + padding * 2) || 1)) - 1,
  }), [minX, maxX, padding, _w]);

  const getColor = useCallback((d: Point): [number, number, number, number] => {
    if (selected.has(d.id)) return [240, 80, 40, 255];
    if (hovered === d.id)   return [251, 191, 36, 255];
    const [r, g, b, a] = encode(d.id, false);
    const dim = selected.size > 0 ? 51 : a;
    return [r, g, b, dim];
  }, [selected, hovered, encode]);

  const brushLayer = brush ? [
    new LineLayer({
      id: 'brush-band',
      data: [{ x0: brush[0], x1: brush[1] }],
      getSourcePosition: (d: { x0: number; x1: number }) => [d.x0, 0, 0],
      getTargetPosition: (d: { x0: number; x1: number }) => [d.x0, 1, 0],
      getColor: [99, 102, 241, 60],
      getWidth: Math.abs(brush[1] - brush[0]),
      widthUnits: 'common',
    }),
  ] : [];

  // Active date range band
  const rangeBand = dateRange ? [
    new LineLayer({
      id: 'date-range-band',
      data: [dateRange],
      getSourcePosition: (d: typeof dateRange) => [d!.startMs, 0, 0],
      getTargetPosition: (d: typeof dateRange) => [d!.startMs, 1, 0],
      getColor: [99, 102, 241, 40],
      getWidth: dateRange.endMs - dateRange.startMs,
      widthUnits: 'common',
    }),
  ] : [];

  if (points.length === 0) {
    return <div className="frame-empty">No temporal data at level "{level}"</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--surface)' }}>
    <DeckGL
      views={new OrthographicView({ id: 'timeline' })}
      initialViewState={viewState}
      onViewStateChange={({ viewState: vs }) => {
        const z = (vs as { zoom?: number }).zoom ?? 0;
        if (initialZoomRef.current === null) initialZoomRef.current = z;
        setZoom(z);
      }}
      controller
      layers={[
        ...rangeBand,
        ...brushLayer,
        // Axis line
        new LineLayer({
          id: 'axis',
          data: [{ from: [minX - padding, 0.07, 0], to: [maxX + padding, 0.07, 0] }],
          getSourcePosition: (d: { from: number[]; to: number[] }) => d.from as [number, number, number],
          getTargetPosition: (d: { from: number[]; to: number[] }) => d.to as [number, number, number],
          getColor: [64, 68, 96, 255],
          getWidth: 1,
          widthUnits: 'pixels',
        }),
        // Tick labels
        new TextLayer({
          id: 'ticks',
          data: ticks,
          getText: (d: { x: number; label: string }) => d.label,
          getPosition: (d: { x: number; label: string }) => [d.x, 0.04, 0],
          getSize: 10,
          getColor: [100, 116, 139, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'top',
          fontFamily: 'ui-monospace, monospace',
        }),
        new ScatterplotLayer<Point>({
          id: 'timeline-points',
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
          updateTriggers: { getFillColor: [selected, hovered, colorBy, nodesById], getRadius: [selected, hovered] },
          transitions: { getFillColor: 120 },
        }),
        new TextLayer<Point>({
          id: 'timeline-labels',
          data: points,
          getText: (d) => {
            const n = nodesById.get(d.id);
            return n ? deriveLabel(n, selected.has(d.id) || d.id === hovered ? 14 : 8, nodesById) : d.id.slice(0, 8);
          },
          getPosition: (d) => [d.x, d.y, 0],
          getPixelOffset: [0, -11],
          getSize: 10,
          getColor: (d) => {
            const zoomed = zoom !== null && initialZoomRef.current !== null && zoom >= initialZoomRef.current + 3;
            const show = selected.has(d.id) || d.id === hovered || zoomed;
            if (selected.has(d.id)) return [240, 80, 40, show ? 220 : 0];
            if (d.id === hovered)   return [251, 191, 36, show ? 220 : 0];
            return [190, 195, 190, show ? 130 : 0];
          },
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          fontFamily: 'ui-monospace, monospace',
          background: true,
          getBorderColor: [0, 0, 0, 0],
          backgroundPadding: [3, 1, 3, 1],
          getBackgroundColor: (d) => {
            const zoomed = zoom !== null && initialZoomRef.current !== null && zoom >= initialZoomRef.current + 3;
            const show = selected.has(d.id) || d.id === hovered || zoomed;
            if (selected.has(d.id)) return [30, 8, 5, show ? 170 : 0];
            return [14, 22, 12, show ? 140 : 0];
          },
          transitions: { getColor: 250, getBackgroundColor: 250 },
          updateTriggers: {
            getColor: [selected, hovered, zoom],
            getBackgroundColor: [selected, hovered, zoom],
            getText: [nodesById, selected, hovered],
          },
        }),
      ]}
      onDragStart={(info, event) => {
        if (!info.coordinate) return;
        const x = info.coordinate[0];
        brushShiftRef.current = !!(event?.srcEvent as MouseEvent | undefined)?.shiftKey;
        setBrush([x, x]);
      }}
      onDrag={(info) => {
        if (!brush || !info.coordinate) return;
        setBrush([brush[0], info.coordinate[0]]);
      }}
      onDragEnd={(info) => {
        if (!brush) return;
        const [a, b] = [Math.min(brush[0], info.coordinate?.[0] ?? brush[1]), Math.max(brush[0], info.coordinate?.[0] ?? brush[1])];
        if (b - a > 1000 * 60 * 60 * 24 * 30) {
          const ids = points.filter((p) => p.x >= a && p.x <= b).map((p) => p.id);
          if (brushShiftRef.current) selectionStore.getState().addToSelection(ids);
          else selectionStore.getState().boxSelect(ids);
          filterStore.getState().setDateRange({ startMs: a, endMs: b });
        }
        setBrush(null);
      }}
    />
    </div>
  );
}
