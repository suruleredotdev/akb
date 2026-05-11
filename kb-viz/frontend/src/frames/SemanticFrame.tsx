import { useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { projectSemantic } from '../projection/projectors/semantic';

interface Point { id: string; position: [number, number]; }

export function SemanticFrame() {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const byType = useStore(dataStore, (s) => s.byType);
  const level = useStore(viewStore, (s) => s.level);
  const selected = useStore(selectionStore, (s) => s.selected);

  const points = useMemo<Point[]>(() => {
    const ids = byType.get(level) ?? [];
    const ns = ids.map((id) => nodesById.get(id)).filter((n): n is NonNullable<typeof n> => n != null);
    const positions = projectSemantic(ns);
    return Array.from(positions.entries()).map(([id, p]) => ({
      id,
      position: [p[0], p[1]] as [number, number],
    }));
  }, [nodesById, byType, level]);

  const initialViewState = useMemo(() => {
    if (points.length === 0) return { target: [0, 0, 0] as [number, number, number], zoom: 0 };
    const xs = points.map((p) => p.position[0]);
    const ys = points.map((p) => p.position[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const range = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      1,
    );
    return { target: [cx, cy, 0] as [number, number, number], zoom: Math.log2(200 / range) };
  }, [points]);

  if (points.length === 0) {
    return <div className="frame-empty">No embeddings at level "{level}"</div>;
  }

  const layers = [
    new ScatterplotLayer<Point>({
      id: 'semantic-points',
      data: points,
      getPosition: (d) => [d.position[0], d.position[1]],
      getRadius: (d) => (selected.has(d.id) ? 9 : 5),
      getFillColor: (d) => (selected.has(d.id) ? [240, 80, 40] : [80, 160, 240]),
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: [255, 255, 255, 80],
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
  ];

  return (
    <DeckGL
      views={new OrthographicView({ id: 'ortho' })}
      initialViewState={initialViewState}
      controller
      layers={layers}
    />
  );
}
