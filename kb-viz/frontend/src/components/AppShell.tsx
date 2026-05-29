import { useCallback } from 'react';
import { Mosaic, MosaicWindow, type MosaicNode, type MosaicPath, updateTree, createRemoveUpdate } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';

import { useStore } from '../lib/use-store';
import { layoutStore, type FrameType, type PaneNode } from '../state/layout-store';
import { getFrame } from '../frames/registry';
import { NodeTooltip } from './NodeTooltip';

const FRAME_LABELS: Record<FrameType, string> = {
  semantic:  'Semantic',
  map:       'Map',
  timeline:  'Timeline',
  chart:     'Length × Position',
  text:      'Text',
  graph:     'Graph',
  search:    'Search',
  entity:    'Entity',
  summary:   'Summary',
};

export function AppShell() {
  const root = useStore(layoutStore, (s) => s.root);
  const maximized = useStore(layoutStore, (s) => s.maximized);

  const onChange = useCallback((next: MosaicNode<FrameType> | null) => {
    if (next) layoutStore.getState().setRoot(next);
  }, []);

  const activeRoot = maximized ?? root;

  return (
    <>
      <Mosaic<FrameType>
        renderTile={(type, path) => {
          const Frame = getFrame(type);
          const paneId = path.length > 0 ? path.join(':') : type;
          return (
            <MosaicWindow<FrameType>
              path={path}
              title={FRAME_LABELS[type] ?? type}
              toolbarControls={<FrameControls type={type} path={path} />}
              createNode={() => 'text' as FrameType}
            >
              {/* Width/height passed as 0 — frames that use them fall back to el.clientWidth */}
              <Frame paneId={paneId} width={0} height={0} />
            </MosaicWindow>
          );
        }}
        value={activeRoot as MosaicNode<FrameType>}
        onChange={onChange}
        className="mosaic-blueprint-theme"
      />
      <NodeTooltip />
    </>
  );
}

function FrameControls({ type, path }: { type: FrameType; path: MosaicPath }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button
        className="btn-ghost"
        title="Maximize"
        onClick={() => {
          const current = layoutStore.getState().maximized;
          layoutStore.getState().maximize(current === type ? null : type);
        }}
      >
        ⤢
      </button>
      <button
        className="btn-ghost"
        title="Close frame"
        onClick={() => {
          const root = layoutStore.getState().root as MosaicNode<FrameType>;
          const next = updateTree(root, [createRemoveUpdate(root, path)]);
          layoutStore.getState().setRoot((next ?? 'semantic') as PaneNode);
        }}
      >
        ✕
      </button>
    </div>
  );
}
