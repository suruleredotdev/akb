import { useMemo, useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder } from '../lib/color-encoder';
import type { UmapRequest, UmapResponse, UmapError } from '../workers/umap.worker';
import type { FrameProps } from './registry';

interface Point { id: string; position: [number, number]; }

// Vite worker import — bundled as a separate chunk
const createWorker = () => new Worker(
  new URL('../workers/umap.worker.ts', import.meta.url),
  { type: 'module' },
);

export function SemanticFrame(_props: FrameProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const nodeTypes = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level     = useStore(viewStore, (s) => s.level);
  const colorBy   = useStore(viewStore, (s) => s.colorBy);
  const selected  = useStore(selectionStore, (s) => s.selected);
  const hovered   = useStore(selectionStore, (s) => s.hovered);
  const scopedIds = useScopedIds(level);

  const [points, setPoints] = useState<Point[]>([]);
  const [computing, setComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  // Input: nodes with embeddings — stable reference used as worker trigger
  const embInput = useMemo(() => {
    const ids: string[] = [];
    const embeddings: number[][] = [];
    for (const id of scopedIds) {
      const n = nodesById.get(id);
      if (n && Array.isArray(n.embedding) && n.embedding.length > 0) {
        ids.push(id);
        embeddings.push(n.embedding);
      }
    }
    return { ids, embeddings };
  }, [nodesById, scopedIds]);

  useEffect(() => {
    if (embInput.embeddings.length === 0) {
      setPoints([]);
      return;
    }

    // Terminate any in-flight worker before starting a new one
    workerRef.current?.terminate();
    const worker = createWorker();
    workerRef.current = worker;
    setComputing(true);

    worker.onmessage = (event: MessageEvent<UmapResponse | UmapError>) => {
      const msg = event.data;
      if (msg.type === 'result') {
        setPoints(msg.ids.map((id, i) => ({ id, position: msg.coords[i] })));
      }
      setComputing(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = () => {
      setComputing(false);
      worker.terminate();
      workerRef.current = null;
    };

    const req: UmapRequest = { ids: embInput.ids, embeddings: embInput.embeddings };
    worker.postMessage(req);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [embInput]);

  const initialViewState = useMemo(() => {
    if (points.length === 0) return { target: [0, 0, 0] as [number, number, number], zoom: 0 };
    const xs = points.map((p) => p.position[0]);
    const ys = points.map((p) => p.position[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const range = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    return { target: [cx, cy, 0] as [number, number, number], zoom: Math.log2(200 / range) };
  }, [points]);

  if (embInput.embeddings.length === 0) {
    return <div className="frame-empty">No embeddings at level "{level}"</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {computing && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          fontSize: 11, color: 'var(--text-dim)', pointerEvents: 'none',
        }}>
          computing UMAP…
        </div>
      )}
      <DeckGL
        views={new OrthographicView({ id: 'ortho' })}
        initialViewState={initialViewState}
        controller
        layers={[
          new ScatterplotLayer<Point>({
            id: 'semantic-points',
            data: points,
            getPosition: (d) => d.position,
            getRadius: (d) => (selected.has(d.id) ? 9 : hovered === d.id ? 7 : 5),
            getFillColor: (d) => {
              if (selected.has(d.id)) return [240, 80, 40, 255];
              if (hovered === d.id) return [251, 191, 36, 255];
              const [r, g, b, a] = encode(d.id, false);
              return [r, g, b, selected.size > 0 ? 51 : a];
            },
            radiusUnits: 'pixels',
            stroked: true,
            getLineColor: [255, 255, 255, 60],
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
              getRadius: [selected, hovered],
              getFillColor: [selected, hovered, colorBy, nodesById],
            },
            transitions: { getFillColor: 120 },
          }),
        ]}
      />
    </div>
  );
}
