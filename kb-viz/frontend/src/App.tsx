import { useEffect, useState } from 'react';
import { dataStore } from './state/data-store';
import { selectionStore } from './state/selection-store';
import { viewStore } from './state/view-store';
import { useStore } from './lib/use-store';
import { loadManifest } from './lib/load-manifest';
import { LevelSelector } from './components/LevelSelector';
import { ColorBySelector } from './components/ColorBySelector';
import { SemanticFrame } from './frames/SemanticFrame';
import { MapFrame } from './frames/MapFrame';
import { TimelineFrame } from './frames/TimelineFrame';
import { ChartFrame } from './frames/ChartFrame';
import { TextFrame } from './frames/TextFrame';

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
      <div style={{ padding: 32, color: '#f05028' }}>
        <strong>Error:</strong> {error}
        <p style={{ marginTop: 16, color: '#9ca3af', fontSize: 13 }}>
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
    return <div style={{ padding: 32 }}>Loading manifest…</div>;
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
        <span className="stat">
          {nodeCount} nodes · {manifest.label ?? manifest.schema_id}
        </span>
        <span className="spacer" />
        <span className="stat">esc clears selection</span>
      </header>
      <main className="main">
        <div className="frames">
          <div className="frame">
            <div className="frame-title">Semantic</div>
            <SemanticFrame />
          </div>
          <div className="frame">
            <div className="frame-title">Map</div>
            <MapFrame />
          </div>
          <div className="frame">
            <div className="frame-title">Timeline</div>
            <TimelineFrame />
          </div>
          <div className="frame">
            <div className="frame-title">Length × Position</div>
            <ChartFrame />
          </div>
        </div>
        <TextFrame />
      </main>
    </div>
  );
}
