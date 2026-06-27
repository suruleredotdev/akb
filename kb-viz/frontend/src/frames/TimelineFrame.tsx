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
import { pickVisibleLabels } from '../lib/pick-visible-labels';
import { PickMenu, type PickMenuState } from '../components/PickMenu';
import type { FrameProps } from './registry';

interface Point { id: string; x: number; y: number; }

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 0.15 + (((h >>> 0) % 1000) / 1000) * 0.7;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Generate tick marks adaptive to the visible time span. */
function adaptiveTicks(visMinMs: number, visMaxMs: number): { x: number; label: string }[] {
  const spanMs = visMaxMs - visMinMs;
  const spanYears = spanMs / (365.25 * 24 * 3600_000);
  const spanDays = spanMs / (24 * 3600_000);
  const ticks: { x: number; label: string }[] = [];

  if (spanYears > 2) {
    // Year-level ticks
    const step = spanYears > 200 ? 50 : spanYears > 50 ? 20 : spanYears > 10 ? 5 : 1;
    const minYear = new Date(visMinMs).getUTCFullYear();
    const maxYear = new Date(visMaxMs).getUTCFullYear();
    for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) {
      ticks.push({ x: Date.UTC(y, 0, 1), label: String(y) });
    }
  } else if (spanDays > 60) {
    // Month / quarter ticks
    const step = spanDays > 180 ? 3 : 1;
    const start = new Date(visMinMs);
    let y = start.getUTCFullYear();
    let m = Math.floor(start.getUTCMonth() / step) * step;
    for (;;) {
      const ms = Date.UTC(y, m, 1);
      if (ms > visMaxMs) break;
      if (ms >= visMinMs) {
        ticks.push({ x: ms, label: m === 0 ? String(y) : `${MONTHS[m]} ${y}` });
      }
      m += step;
      if (m >= 12) { m = 0; y++; }
    }
  } else {
    // Day / week ticks
    const step = spanDays > 14 ? 7 : 1;
    const DAY = 24 * 3600_000;
    let t = Math.ceil(visMinMs / (DAY * step)) * DAY * step;
    while (t <= visMaxMs) {
      const d = new Date(t);
      ticks.push({
        x: t,
        label: step >= 7
          ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
          : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
      });
      t += DAY * step;
    }
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
  const [viewCenter, setViewCenter] = useState<number | null>(null);
  // Store the initial zoom so we can use it as a relative threshold
  const initialZoomRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckRef = useRef<any>(null);
  const [pickMenu, setPickMenu] = useState<PickMenuState | null>(null);
  const handlePick = useCallback((id: string, shift: boolean) => {
    if (shift) selectionStore.getState().toggle(id);
    else selectionStore.getState().selectOnly(id);
    setPickMenu(null);
  }, []);

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

  const padding = (maxX - minX) * 0.05 || 1e9;
  const viewState = useMemo(() => ({
    target: [(minX + maxX) / 2, 0.5, 0] as [number, number, number],
    zoom: Math.log2((_w || 800) / ((maxX - minX + padding * 2) || 1)) - 1,
  }), [minX, maxX, padding, _w]);

  // Compute the visible x-range from viewport state for adaptive ticks
  const ticks = useMemo(() => {
    const w = _w || 800;
    const z = zoom ?? viewState.zoom;
    const cx = viewCenter ?? (minX + maxX) / 2;
    const halfWidth = (w / 2) / Math.pow(2, z);
    return adaptiveTicks(cx - halfWidth, cx + halfWidth);
  }, [zoom, viewCenter, minX, maxX, _w, viewState.zoom]);

  // Grid-thinned set of IDs whose ambient labels should be visible
  const visibleLabelIds = useMemo(() => {
    const baseZoom = initialZoomRef.current;
    if (zoom === null || baseZoom === null || zoom < baseZoom + 3) return new Set<string>();
    const zoomDelta = zoom - (baseZoom + 3);
    const divisions = Math.max(8, Math.floor(8 + zoomDelta * 8));
    return pickVisibleLabels(points, (p) => [p.x, p.y], divisions);
  }, [points, zoom]);

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
      ref={deckRef}
      views={new OrthographicView({ id: 'timeline' })}
      initialViewState={viewState}
      onViewStateChange={({ viewState: vs }) => {
        const z = (vs as { zoom?: number }).zoom ?? 0;
        if (initialZoomRef.current === null) initialZoomRef.current = z;
        setZoom(z);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = (vs as any).target;
        if (target) setViewCenter(target[0]);
        setPickMenu(null);
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
        // Tick marks
        new LineLayer({
          id: 'tick-lines',
          data: ticks,
          getSourcePosition: (d: { x: number }) => [d.x, 0.05, 0],
          getTargetPosition: (d: { x: number }) => [d.x, 0.07, 0],
          getColor: [64, 68, 96, 160],
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
            setPickMenu(null);
            const id = (info.object as Point | undefined)?.id;
            if (!id) return;
            const picks = deckRef.current?.pickMultipleObjects?.({
              x: info.x, y: info.y, layerIds: ['timeline-points'],
            }) ?? [];
            const ids = [...new Set(
              picks.map((p: { object?: Point }) => p.object?.id).filter(Boolean) as string[],
            )];
            if (ids.length > 1) {
              setPickMenu({ x: info.x, y: info.y, ids });
              return;
            }
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
            return n ? deriveLabel(n, selected.has(d.id) || d.id === hovered ? 14 : 8) : d.id.slice(0, 8);
          },
          getPosition: (d) => [d.x, d.y, 0],
          getPixelOffset: [0, -11],
          getSize: 10,
          getColor: (d) => {
            if (selected.has(d.id)) return [240, 80, 40, 220];
            if (d.id === hovered)   return [251, 191, 36, 220];
            if (visibleLabelIds.has(d.id)) return [190, 195, 190, 130];
            return [190, 195, 190, 0];
          },
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          fontFamily: 'ui-monospace, monospace',
          background: true,
          getBorderColor: [0, 0, 0, 0],
          backgroundPadding: [3, 1, 3, 1],
          getBackgroundColor: (d) => {
            if (selected.has(d.id)) return [30, 8, 5, 170];
            if (d.id === hovered)   return [14, 22, 12, 140];
            if (visibleLabelIds.has(d.id)) return [14, 22, 12, 120];
            return [14, 22, 12, 0];
          },
          transitions: { getColor: 250, getBackgroundColor: 250 },
          updateTriggers: {
            getColor: [selected, hovered, visibleLabelIds],
            getBackgroundColor: [selected, hovered, visibleLabelIds],
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
    {pickMenu && <PickMenu menu={pickMenu} onPick={handlePick} onClose={() => setPickMenu(null)} />}
    </div>
  );
}
