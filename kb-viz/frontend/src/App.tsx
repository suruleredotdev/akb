import { useEffect, useState } from 'react';
import { dataStore } from './state/data-store';
import { selectionStore } from './state/selection-store';
import { viewStore } from './state/view-store';
import { useStore } from './lib/use-store';
import { loadManifest } from './lib/load-manifest';
import { LevelSelector } from './components/LevelSelector';
import { ColorBySelector } from './components/ColorBySelector';
import { AppShell } from './components/AppShell';
import { layoutStore } from './state/layout-store';
import type { FrameType } from './state/layout-store';

// Register all frames with the registry
import './frames/index';

const PRESET_LABELS: [string, string][] = [
  ['4-panel', '4-panel'],
  ['map-focus', 'map focus'],
  ['text-focus', 'text focus'],
  ['single', 'single'],
];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const manifest = useStore(dataStore, (s) => s.manifest);
  const nodeCount = useStore(dataStore, (s) => s.nodes.size);
  const scope = useStore(viewStore, (s) => s.scope);

  useEffect(() => {
    loadManifest('/manifest.json')
      .then((m) => dataStore.getState().load(m))
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectionStore.getState().clear();
        viewStore.getState().drillOut();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (error) {
    return (
      <div style={{ padding: 32, color: 'var(--selected)' }}>
        <strong>Error:</strong> {error}
        <p style={{ marginTop: 16, color: 'var(--text-dim)', fontSize: 13 }}>
          Make sure <code>public/manifest.json</code> exists. Generate one with:
          <br />
          <code style={{ display: 'block', marginTop: 8 }}>
            python -m kb_viz.akb_adapter path/to/akb/data/archive.db -o frontend/public/manifest.json
          </code>
        </p>
      </div>
    );
  }
  if (!manifest) {
    return <div style={{ padding: 32, color: 'var(--text-dim)' }}>Loading manifest…</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>kb-viz</h1>
        <LevelSelector />
        <ColorBySelector />
        {scope !== 'global' && (
          <button className="scope-pill" onClick={() => viewStore.getState().drillOut()}>
            ↑ exit scope
          </button>
        )}
        <PresetPicker />
        <AddFrameButton />
        <span className="spacer" />
        <span className="stat">{nodeCount} nodes · {manifest.label ?? manifest.schema_id}</span>
        <span className="stat" style={{ color: 'var(--text-muted)' }}>esc clears</span>
      </header>
      <main style={{ height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
        <AppShell />
      </main>
    </div>
  );
}

function PresetPicker() {
  return (
    <select
      className="ctrl-select"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) {
          layoutStore.getState().loadPreset(e.target.value);
          e.target.value = '';
        }
      }}
    >
      <option value="" disabled>layout…</option>
      {PRESET_LABELS.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}

const ADDABLE_FRAMES: FrameType[] = ['semantic', 'map', 'timeline', 'chart', 'text'];

function AddFrameButton() {
  return (
    <select
      className="ctrl-select"
      defaultValue=""
      onChange={(e) => {
        const type = e.target.value as FrameType;
        if (!type) return;
        // Split root horizontally, adding new frame as the second pane
        const root = layoutStore.getState().root;
        layoutStore.getState().setRoot({ direction: 'row', first: root, second: type, splitPercentage: 70 });
        e.target.value = '';
      }}
    >
      <option value="" disabled>+ frame</option>
      {ADDABLE_FRAMES.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );
}
