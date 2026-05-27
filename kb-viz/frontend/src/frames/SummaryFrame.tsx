import { useMemo } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { historyStore } from '../state/history-store';
import { deriveLabel } from '../lib/derive-label';
import { isGeographic, isTemporal, isEntityRef } from '../types/manifest';
import type { Node } from '../types/manifest';
import type { FrameProps } from './registry';

const S: Record<string, React.CSSProperties> = {
  frame:    { padding: '12px 14px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', boxSizing: 'border-box' },
  section:  { display: 'flex', flexDirection: 'column', gap: 6 },
  heading:  { fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: 'var(--title-color)', margin: 0 },
  empty:    { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' },
  row:      { display: 'flex', alignItems: 'baseline', gap: 6 },
  label:    { fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, flex: 1 },
  badge:    { fontSize: 10, background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', borderRadius: 3, padding: '1px 5px', color: 'var(--text-dim)', whiteSpace: 'nowrap' as const },
  dimId:    { fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 },
  navBtn:   { background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' as const, width: '100%' },
  chip:     { fontSize: 10, padding: '2px 7px', borderRadius: 9999, border: 'var(--border-width) solid var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' },
  digestKv: { display: 'flex', gap: 8, fontSize: 12 },
  digestKey:{ color: 'var(--text-dim)', minWidth: 80 },
  digestVal:{ color: 'var(--text)', flex: 1 },
};

export function SummaryFrame(_props: FrameProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const selected  = useStore(selectionStore, (s) => s.selected);
  const focused   = useStore(selectionStore, (s) => s.focused);
  const visited   = useStore(historyStore, (s) => s.visited);

  const selectedNodes = useMemo(
    () => [...selected].map((id) => nodesById.get(id)).filter((n): n is Node => n != null),
    [selected, nodesById],
  );

  const digest = useMemo(() => computeDigest(selectedNodes), [selectedNodes]);

  return (
    <div style={S.frame}>
      {/* ── History ── */}
      <div style={S.section}>
        <p style={S.heading}>history</p>
        {visited.length === 0
          ? <span style={S.empty}>No nodes visited yet</span>
          : visited.slice(0, 20).map((id) => {
              const n = nodesById.get(id);
              const isFocused = id === focused;
              return (
                <button
                  key={id}
                  style={{ ...S.navBtn, opacity: isFocused ? 1 : 0.75 }}
                  onClick={() => selectionStore.getState().selectOnly(id)}
                >
                  <div style={S.row}>
                    <span style={{ ...S.label, fontWeight: isFocused ? 600 : 400, color: isFocused ? 'var(--accent)' : 'var(--text)' }}>
                      {n ? deriveLabel(n, 50) : id}
                    </span>
                    {n && <span style={S.badge}>{n.type}</span>}
                  </div>
                  {n && deriveLabel(n, 50) !== n.id && (
                    <div style={S.dimId}>{n.id}</div>
                  )}
                </button>
              );
            })}
      </div>

      {/* ── Current selection ── */}
      <div style={S.section}>
        <p style={S.heading}>selection · {selected.size}</p>
        {selected.size === 0
          ? <span style={S.empty}>Nothing selected</span>
          : selected.size > 8
          ? <SelectionSummary nodes={selectedNodes} />
          : selectedNodes.map((n) => (
              <button
                key={n.id}
                style={{ ...S.navBtn, opacity: n.id === focused ? 1 : 0.8 }}
                onClick={() => selectionStore.getState().selectOnly(n.id)}
              >
                <div style={S.row}>
                  <span style={{ ...S.label, color: n.id === focused ? 'var(--selected)' : 'var(--text)' }}>
                    {deriveLabel(n, 50)}
                  </span>
                  <span style={S.badge}>{n.type}</span>
                </div>
              </button>
            ))}
      </div>

      {/* ── Context digest ── */}
      {selectedNodes.length > 0 && (
        <div style={S.section}>
          <p style={S.heading}>context digest</p>
          <DigestView digest={digest} />
        </div>
      )}
    </div>
  );
}

function SelectionSummary({ nodes }: { nodes: Node[] }) {
  const byType = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {Object.entries(byType).map(([type, count]) => (
        <span key={type} style={S.chip}>{count} {type}{count !== 1 ? 's' : ''}</span>
      ))}
    </div>
  );
}

interface Digest {
  temporalSpan: { start: string; end: string } | null;
  topLocations: string[];
  topEntities: string[];
}

function computeDigest(nodes: Node[]): Digest {
  const dates: string[] = [];
  const locCounts: Record<string, number> = {};
  const entityCounts: Record<string, number> = {};

  for (const n of nodes) {
    for (const a of n.annotations) {
      if (isTemporal(a.value)) dates.push(a.value.iso_start);
      if (isGeographic(a.value) && a.value.name) {
        locCounts[a.value.name] = (locCounts[a.value.name] ?? 0) + 1;
      }
      if (isEntityRef(a.value) && a.value.name) {
        entityCounts[a.value.name] = (entityCounts[a.value.name] ?? 0) + 1;
      }
    }
  }

  const sorted = [...dates].sort();
  return {
    temporalSpan: sorted.length > 0 ? { start: sorted[0], end: sorted[sorted.length - 1] } : null,
    topLocations: Object.entries(locCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
    topEntities:  Object.entries(entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
  };
}

function DigestView({ digest }: { digest: Digest }) {
  if (!digest.temporalSpan && digest.topLocations.length === 0 && digest.topEntities.length === 0) {
    return <span style={S.empty}>No annotations in selection</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {digest.temporalSpan && (
        <div style={S.digestKv}>
          <span style={S.digestKey}>time span</span>
          <span style={S.digestVal}>
            {digest.temporalSpan.start === digest.temporalSpan.end
              ? digest.temporalSpan.start
              : `${digest.temporalSpan.start} → ${digest.temporalSpan.end}`}
          </span>
        </div>
      )}
      {digest.topLocations.length > 0 && (
        <div style={S.digestKv}>
          <span style={S.digestKey}>locations</span>
          <span style={S.digestVal}>{digest.topLocations.join(', ')}</span>
        </div>
      )}
      {digest.topEntities.length > 0 && (
        <div style={S.digestKv}>
          <span style={S.digestKey}>entities</span>
          <span style={S.digestVal}>{digest.topEntities.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
