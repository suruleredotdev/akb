import { useMemo, useEffect, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import { useStore } from '../lib/use-store';
import { useScopedIds } from '../lib/use-scoped-ids';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { makeColorEncoder } from '../lib/color-encoder';
import { useBoxSelect, BoxSelectOverlay } from '../lib/use-box-select';
import type { GraphLayoutRequest, GraphLayoutResponse } from '../workers/graph-layout.worker';
import type { FrameProps } from './registry';

interface GNode { id: string; position: [number, number, number]; }
interface GEdge { source: [number, number, number]; target: [number, number, number]; }

const createWorker = () => new Worker(
  new URL('../workers/graph-layout.worker.ts', import.meta.url),
  { type: 'module' },
);

// Edge types to filter on (all shown by default; user can narrow)
const EDGE_TYPES = ['next', 'similarity', 'citation', 'co_occurrence'] as const;
type EdgeTypeName = typeof EDGE_TYPES[number];

export function GraphFrame(_props: FrameProps) {
  const nodesById  = useStore(dataStore, (s) => s.nodes);
  const allEdges   = useStore(dataStore, (s) => s.edges);
  const nodeTypes  = useStore(dataStore, (s) => s.manifest?.node_types ?? []);
  const level      = useStore(viewStore, (s) => s.level);
  const colorBy    = useStore(viewStore, (s) => s.colorBy);
  const selected   = useStore(selectionStore, (s) => s.selected);
  const hovered    = useStore(selectionStore, (s) => s.hovered);
  const scopedIds  = useScopedIds(level);

  const [positions, setPositions] = useState<Record<string, [number, number]>>({});
  const [computing, setComputing] = useState(false);
  const [activeEdgeTypes, setActiveEdgeTypes] = useState<Set<EdgeTypeName>>(
    new Set(EDGE_TYPES),
  );
  const workerRef = useRef<Worker | null>(null);

  const encode = useMemo(
    () => makeColorEncoder(nodesById, nodeTypes, colorBy),
    [nodesById, nodeTypes, colorBy],
  );

  const scopedSet = useMemo(() => new Set(scopedIds), [scopedIds]);

  // Edges within current scope
  const scopedEdges = useMemo(() => {
    const result: { id: string; source: string; target: string; type: string }[] = [];
    for (const [, e] of allEdges) {
      if (scopedSet.has(e.source) && scopedSet.has(e.target)) {
        result.push({ id: e.id, source: e.source, target: e.target, type: e.type });
      }
    }
    // Also add parent-child edges for nodes in scope
    for (const id of scopedIds) {
      const n = nodesById.get(id);
      if (!n) continue;
      for (const cid of n.child_ids) {
        if (scopedSet.has(cid)) {
          result.push({ id: `pc:${id}:${cid}`, source: id, target: cid, type: 'next' });
        }
      }
    }
    return result;
  }, [allEdges, scopedSet, scopedIds, nodesById]);

  // Run layout worker when scope changes
  const layoutInput = useMemo(
    () => ({ nodes: scopedIds.map((id) => ({ id })), edges: scopedEdges }),
    [scopedIds, scopedEdges],
  );

  useEffect(() => {
    if (layoutInput.nodes.length === 0) { setPositions({}); return; }
    workerRef.current?.terminate();
    const worker = createWorker();
    workerRef.current = worker;
    setComputing(true);

    worker.onmessage = (event: MessageEvent<GraphLayoutResponse>) => {
      setPositions(event.data.positions);
      setComputing(false);
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = () => {
      setComputing(false);
      worker.terminate();
      workerRef.current = null;
    };

    const req: GraphLayoutRequest = { nodes: layoutInput.nodes, edges: layoutInput.edges };
    worker.postMessage(req);
    return () => { worker.terminate(); workerRef.current = null; };
  }, [layoutInput]);

  const nodes = useMemo<GNode[]>(() =>
    scopedIds
      .filter((id) => positions[id])
      .map((id) => ({ id, position: [positions[id][0], positions[id][1], 0] as [number, number, number] })),
    [scopedIds, positions],
  );

  const edges = useMemo<GEdge[]>(() => {
    const result: GEdge[] = [];
    for (const e of scopedEdges) {
      if (!activeEdgeTypes.has(e.type as EdgeTypeName)) continue;
      const s = positions[e.source];
      const t = positions[e.target];
      if (s && t) result.push({ source: [s[0], s[1], 0], target: [t[0], t[1], 0] });
    }
    return result;
  }, [scopedEdges, positions, activeEdgeTypes]);

  const viewState = useMemo(() => ({
    target: [0.5, 0.5, 0] as [number, number, number],
    zoom: 0,
  }), []);

  const toggleType = (t: EdgeTypeName) => {
    setActiveEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) { next.delete(t); } else { next.add(t); }
      return next;
    });
  };

  // Count which edge types are actually present in scope
  const presentTypes = useMemo(() => {
    const s = new Set(scopedEdges.map((e) => e.type));
    return EDGE_TYPES.filter((t) => s.has(t));
  }, [scopedEdges]);

  const { deckRef, dragRect, onMouseDown } = useBoxSelect<GNode>({
    extractId: (obj) => obj?.id,
    onSelect: (ids, shift) => {
      if (shift) selectionStore.getState().addToSelection(ids);
      else selectionStore.getState().boxSelect(ids);
    },
  });

  if (scopedIds.length === 0) {
    return <div className="frame-empty">No nodes at level "{level}"</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} onMouseDown={onMouseDown}>
      {/* Edge type filters */}
      {presentTypes.length > 0 && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 4 }}>
          {presentTypes.map((t) => (
            <button
              key={t}
              className={activeEdgeTypes.has(t) ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 11, padding: '2px 7px' }}
              onClick={() => toggleType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {computing && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          fontSize: 11, color: 'var(--text-dim)', pointerEvents: 'none',
        }}>
          computing layout…
        </div>
      )}
      {dragRect && <BoxSelectOverlay rect={dragRect} />}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <DeckGL
        ref={deckRef as any}
        views={new OrthographicView({ id: 'graph' })}
        initialViewState={viewState}
        controller
        layers={[
          new LineLayer<GEdge>({
            id: 'graph-edges',
            data: edges,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getColor: [99, 102, 241, 60],
            getWidth: 1,
            widthUnits: 'pixels',
          }),
          new ScatterplotLayer<GNode>({
            id: 'graph-nodes',
            data: nodes,
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
            getLineColor: [255, 255, 255, 40],
            lineWidthUnits: 'pixels',
            lineWidthMinPixels: 1,
            pickable: true,
            onClick: (info) => {
              const id = (info.object as GNode | undefined)?.id;
              if (id) selectionStore.getState().selectOnly(id);
            },
            onHover: (info) => {
              selectionStore.getState().hover((info.object as GNode | undefined)?.id ?? null);
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
