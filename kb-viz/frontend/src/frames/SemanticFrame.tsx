import { useMemo, useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { OrthographicView, OrbitView, LinearInterpolator } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { useEffectiveIds } from '../lib/use-effective-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder } from '../lib/color-encoder';
import { useBoxSelect, BoxSelectOverlay } from '../lib/use-box-select';
import type { SemanticFrameConfig } from '../state/view-store';
import type { UmapRequest, UmapResponse, UmapError } from '../workers/umap.worker';
import type { FrameProps } from './registry';

interface Point { id: string; position: [number, number, number]; }

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
  const focused   = useStore(selectionStore, (s) => s.focused);
  const effectiveIds = useEffectiveIds(level);
  const rawConfig = useStore(viewStore, (s) => s.frameConfigs['semantic']);
  const config    = (rawConfig ?? { mode: '2d', showKnnEdges: false, knnK: 5 }) as SemanticFrameConfig;
  const mode      = config.mode;

  const [points, setPoints] = useState<Point[]>([]);
  const [computing, setComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const [deckViewState, setDeckViewState] = useState<object | null>(null);
  const initialFitDone = useRef(false);

  const { deckRef, dragRect, onMouseDown } = useBoxSelect<Point>({
    extractId: (obj) => obj?.id,
    onSelect: (ids, shift) => {
      if (shift) selectionStore.getState().addToSelection(ids);
      else selectionStore.getState().boxSelect(ids);
    },
  });

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const embInput = useMemo(() => {
    const ids: string[] = [];
    const embeddings: number[][] = [];
    for (const id of effectiveIds) {
      const n = nodesById.get(id);
      if (n && Array.isArray(n.embedding) && n.embedding.length > 0) {
        ids.push(id);
        embeddings.push(n.embedding);
      }
    }
    return { ids, embeddings };
  }, [nodesById, effectiveIds]);

  useEffect(() => {
    if (embInput.embeddings.length === 0) {
      setPoints([]);
      return;
    }

    workerRef.current?.terminate();
    const worker = createWorker();
    workerRef.current = worker;
    setComputing(true);

    worker.onmessage = (event: MessageEvent<UmapResponse | UmapError>) => {
      const msg = event.data;
      if (msg.type === 'result') {
        setPoints(msg.ids.map((id, i) => {
          const c = msg.coords[i];
          return { id, position: [c[0], c[1], c[2] ?? 0] as [number, number, number] };
        }));
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

    const req: UmapRequest = {
      ids: embInput.ids,
      embeddings: embInput.embeddings,
      nComponents: mode === '3d' ? 3 : 2,
    };
    worker.postMessage(req);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [embInput, mode]);

  // Reset initial-fit flag when level or mode changes so camera re-centres on new data
  useEffect(() => { initialFitDone.current = false; }, [level, mode]);

  // Set camera to fit all points when they first arrive (or after level/mode change)
  useEffect(() => {
    if (points.length === 0 || initialFitDone.current) return;
    initialFitDone.current = true;
    if (mode === '3d') {
      setDeckViewState({ target: [0, 0, 0], zoom: 0, rotationX: 20, rotationOrbit: 30 });
    } else {
      const xs = points.map((p) => p.position[0]);
      const ys = points.map((p) => p.position[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const range = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
      setDeckViewState({ target: [cx, cy, 0], zoom: Math.log2(200 / range) });
    }
  }, [points, mode]);

  // Zoom to focused point when focus changes
  useEffect(() => {
    if (!focused || points.length === 0) return;
    const pt = points.find((p) => p.id === focused);
    if (!pt) return;
    setDeckViewState((prev) => ({
      ...(prev ?? {}),
      target: [pt.position[0], pt.position[1], 0] as [number, number, number],
      zoom: 4,
      transitionDuration: 400,
      transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
    }));
  }, [focused, points]);

  if (embInput.embeddings.length === 0) {
    return (
      <div className="frame-empty">
        <div>No embeddings at level <strong>{level}</strong></div>
        <div className="frame-empty-hint">
          {level === 'document'
            ? 'Document-level embeddings are not yet generated. Switch to "chunk" level, or run akb embed --all.'
            : 'Drill into a node to see embeddings at a finer level, or run akb embed --all to generate chunk embeddings.'}
        </div>
      </div>
    );
  }

  const view = mode === '3d'
    ? new OrbitView({ id: 'orbit' })
    : new OrthographicView({ id: 'ortho' });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--surface)' }}
      onMouseDown={onMouseDown}
    >
      {/* 2D / 3D toggle */}
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        {(['2d', '3d'] as const).map((m) => (
          <button
            key={m}
            className={mode === m ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 11, padding: '2px 7px' }}
            onClick={() => viewStore.getState().setFrameConfig('semantic', { mode: m })}
          >
            {m}
          </button>
        ))}
      </div>
      {computing && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          fontSize: 11, color: 'var(--text-dim)', pointerEvents: 'none',
        }}>
          computing UMAP…
        </div>
      )}
      {dragRect && <BoxSelectOverlay rect={dragRect} />}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <DeckGL
        ref={deckRef as any}
        key={mode}
        views={view}
        viewState={deckViewState ?? undefined}
        initialViewState={deckViewState ? undefined : { target: [0, 0, 0] as [number,number,number], zoom: 0 }}
        onViewStateChange={({ viewState: vs }) => setDeckViewState(vs as object)}
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
      />
    </div>
  );
}
