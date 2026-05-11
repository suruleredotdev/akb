import { useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { projectMap } from '../projection/projectors/map';

interface Point { id: string; position: [number, number]; }

export function MapFrame() {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const byType = useStore(dataStore, (s) => s.byType);
  const level = useStore(viewStore, (s) => s.level);
  const selected = useStore(selectionStore, (s) => s.selected);

  const points = useMemo<Point[]>(() => {
    const ids = byType.get(level) ?? [];
    const ns = ids.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectMap(ns, nodesById);
    return Array.from(positions.entries()).map(([id, p]) => ({
      id,
      position: [p[0], p[1]] as [number, number],
    }));
  }, [nodesById, byType, level]);

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

  return (
    <DeckGL
      initialViewState={initialViewState}
      controller
      layers={[
        new ScatterplotLayer<Point>({
          id: 'map-points',
          data: points,
          getPosition: (d) => [d.position[0], d.position[1]],
          getRadius: (d) => (selected.has(d.id) ? 11 : 7),
          getFillColor: (d) => (selected.has(d.id) ? [240, 80, 40] : [34, 197, 94]),
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: [255, 255, 255, 120],
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 1,
          pickable: true,
          onClick: (info) => {
            const id = (info.object as Point | undefined)?.id;
            if (id) selectionStore.getState().selectOnly(id);
          },
          onHover: (info) => {
            const id = (info.object as Point | undefined)?.id;
            selectionStore.getState().hover(id ?? null);
          },
          updateTriggers: {
            getRadius: [selected],
            getFillColor: [selected],
          },
        }),
      ]}
    >
      <Map
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        attributionControl={false}
      />
    </DeckGL>
  );
}
