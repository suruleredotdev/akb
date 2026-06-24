import { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, LineLayer, ArcLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { Map as MapGL } from 'react-map-gl/maplibre';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder } from '../lib/color-encoder';
import { projectMap } from '../projection/projectors/map';
import { deriveLabel } from '../lib/derive-label';
import type { FrameProps } from './registry';

interface Point { id: string; position: [number, number]; }

// Graham scan convex hull — returns polygon vertices in CCW order
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return [...lower, ...upper];
}

export function MapFrame(_props: FrameProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const nodeTypes = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level     = useStore(viewStore, (s) => s.level);
  const colorBy   = useStore(viewStore, (s) => s.colorBy);
  const selected  = useStore(selectionStore, (s) => s.selected);
  const hovered   = useStore(selectionStore, (s) => s.hovered);
  const scopedIds = useScopedIds(level);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showArcs, setShowArcs] = useState(true);
  const [showHull, setShowHull] = useState(true);
  const [zoom, setZoom] = useState(3.5);
  const LABEL_ZOOM = 6;

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const points = useMemo<Point[]>(() => {
    const ns = scopedIds.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectMap(ns, nodesById);
    return Array.from(positions.entries()).map(([id, p]) => ({
      id,
      position: [p[0], p[1]] as [number, number],
    }));
  }, [nodesById, scopedIds]);

  const initialViewState = useMemo(() => {
    if (points.length === 0) return { longitude: 0, latitude: 20, zoom: 1 };
    const lngs = points.map((p) => p.position[0]);
    const lats = points.map((p) => p.position[1]);
    return {
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      zoom: 3.5,
    };
  }, [points]);

  // Selected points with geo data (in selection order for arc drawing)
  const selectedPoints = useMemo(() => {
    const byId = new Map(points.map((p) => [p.id, p]));
    return [...selected].map((id) => byId.get(id)).filter((p): p is Point => p != null);
  }, [points, selected]);

  // Arcs: consecutive selected points
  const arcData = useMemo(() => {
    if (selectedPoints.length < 2) return [];
    const arcs = [];
    for (let i = 0; i < selectedPoints.length - 1; i++) {
      arcs.push({ source: selectedPoints[i].position, target: selectedPoints[i + 1].position });
    }
    return arcs;
  }, [selectedPoints]);

  // Convex hull segments (only when ≥ 3 selected geo points)
  const hullSegments = useMemo(() => {
    if (selectedPoints.length < 3) return [];
    const hull = convexHull(selectedPoints.map((p) => p.position));
    const segments = [];
    for (let i = 0; i < hull.length; i++) {
      segments.push({ from: hull[i], to: hull[(i + 1) % hull.length] });
    }
    return segments;
  }, [selectedPoints]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Layer toggles */}
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        {[
          { label: 'heat', val: showHeatmap, set: setShowHeatmap },
          { label: 'arcs', val: showArcs,    set: setShowArcs },
          { label: 'hull', val: showHull,    set: setShowHull },
        ].map(({ label, val, set }) => (
          <button
            key={label}
            className={val ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 11, padding: '2px 7px' }}
            onClick={() => set(!val)}
          >
            {label}
          </button>
        ))}
      </div>

      <DeckGL
        initialViewState={initialViewState}
        onViewStateChange={({ viewState: vs }) => setZoom((vs as { zoom?: number }).zoom ?? 3)}
        controller
        layers={[
          ...(showHeatmap ? [
            new HeatmapLayer<Point>({
              id: 'heatmap',
              data: points,
              getPosition: (d) => d.position,
              getWeight: 1,
              radiusPixels: 40,
              intensity: 1,
              threshold: 0.05,
              colorRange: [
                [0, 0, 80, 0], [0, 0, 200, 80], [0, 100, 255, 160],
                [80, 200, 255, 200], [255, 255, 0, 220], [255, 60, 0, 255],
              ],
            }),
          ] : []),
          ...(showArcs && arcData.length > 0 ? [
            new ArcLayer<{ source: [number, number]; target: [number, number] }>({
              id: 'arcs',
              data: arcData,
              getSourcePosition: (d) => d.source,
              getTargetPosition: (d) => d.target,
              getSourceColor: [99, 102, 241, 180],
              getTargetColor: [240, 80, 40, 180],
              getWidth: 2,
              widthUnits: 'pixels',
              greatCircle: true,
            }),
          ] : []),
          ...(showHull && hullSegments.length > 0 ? [
            new LineLayer<{ from: [number, number]; to: [number, number] }>({
              id: 'hull',
              data: hullSegments,
              getSourcePosition: (d) => d.from,
              getTargetPosition: (d) => d.to,
              getColor: [99, 102, 241, 120],
              getWidth: 1.5,
              widthUnits: 'pixels',
            }),
          ] : []),
          new TextLayer<Point>({
            id: 'map-labels',
            data: points,
            getText: (d) => {
              const n = nodesById.get(d.id);
              return n ? deriveLabel(n, selected.has(d.id) || d.id === hovered ? 14 : 8) : d.id.slice(0, 8);
            },
            getPosition: (d) => d.position,
            getPixelOffset: [0, -14],
            getSize: 11,
            getColor: (d) => {
              const show = selected.has(d.id) || d.id === hovered || zoom >= LABEL_ZOOM;
              if (selected.has(d.id)) return [240, 80, 40, show ? 230 : 0];
              if (d.id === hovered)   return [251, 191, 36, show ? 230 : 0];
              return [220, 225, 220, show ? 180 : 0];
            },
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'bottom',
            fontFamily: 'system-ui, sans-serif',
            background: true,
            getBorderColor: [0, 0, 0, 0],
            backgroundPadding: [4, 1, 4, 1],
            getBackgroundColor: (d) => {
              const show = selected.has(d.id) || d.id === hovered || zoom >= LABEL_ZOOM;
              if (selected.has(d.id)) return [40, 10, 5, show ? 190 : 0];
              return [10, 10, 10, show ? 170 : 0];
            },
            transitions: { getColor: 250, getBackgroundColor: 250 },
            updateTriggers: {
              getColor: [selected, hovered, zoom],
              getBackgroundColor: [selected, hovered, zoom],
              getText: [nodesById, selected, hovered],
            },
          }),
          new ScatterplotLayer<Point>({
            id: 'map-points',
            data: points,
            getPosition: (d) => d.position,
            getRadius: (d) => (selected.has(d.id) ? 11 : hovered === d.id ? 9 : 7),
            getFillColor: (d) => {
              if (selected.has(d.id)) return [240, 80, 40, 255];
              if (hovered === d.id) return [251, 191, 36, 255];
              const [r, g, b, a] = encode(d.id, false);
              return [r, g, b, selected.size > 0 ? 80 : a];
            },
            radiusUnits: 'pixels',
            stroked: true,
            getLineColor: [255, 255, 255, 100],
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
              const id = (info.object as Point | undefined)?.id;
              selectionStore.getState().hover(id ?? null);
            },
            updateTriggers: {
              getRadius: [selected, hovered],
              getFillColor: [selected, hovered, colorBy, nodesById],
            },
            transitions: { getFillColor: 120 },
          }),
        ]}
      >
        <MapGL
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          attributionControl={false}
        />
      </DeckGL>
    </div>
  );
}
