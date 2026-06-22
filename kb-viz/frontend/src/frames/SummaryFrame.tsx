import { useMemo } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { historyStore } from '../state/history-store';
import { filterStore } from '../state/filter-store';
import { deriveLabel } from '../lib/derive-label';
import { computeDigest } from '../lib/compute-digest';
import type { Digest } from '../lib/compute-digest';
import type { Node } from '../types/manifest';
import type { FrameProps } from './registry';

const S: Record<string, React.CSSProperties> = {
  frame:     { padding: '12px 14px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--surface)', boxSizing: 'border-box' },
  section:   { display: 'flex', flexDirection: 'column', gap: 6 },
  heading:   { fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: 'var(--title-color)', margin: 0 },
  empty:     { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' },
  row:       { display: 'flex', alignItems: 'baseline', gap: 6 },
  label:     { fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, flex: 1 },
  badge:     { fontSize: 10, background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', borderRadius: 3, padding: '1px 5px', color: 'var(--text-dim)', whiteSpace: 'nowrap' as const },
  dimId:     { fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 },
  navBtn:    { background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' as const, width: '100%' },
  chip:      { fontSize: 10, padding: '2px 7px', borderRadius: 9999, border: 'var(--border-width) solid var(--border)', background: 'var(--bg)', color: 'var(--text-dim)' },
  digestKv:  { display: 'flex', gap: 8, fontSize: 12 },
  digestKey: { color: 'var(--text-dim)', minWidth: 80 },
  digestVal: { color: 'var(--text)', flex: 1 },
  digestHint:{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' },
};

/** Max number of history nodes included in the context digest. */
const HISTORY_DIGEST_LIMIT = 20;

export function SummaryFrame(_props: FrameProps) {
  const nodesById         = useStore(dataStore, (s) => s.nodes);
  const byParent          = useStore(dataStore, (s) => s.byParent);
  const selected          = useStore(selectionStore, (s) => s.selected);
  const focused           = useStore(selectionStore, (s) => s.focused);
  const visited           = useStore(historyStore, (s) => s.visited);
  const filterToSelection = useStore(filterStore, (s) => s.filterToSelection);

  const selectedNodes = useMemo(
    () => [...selected].map((id) => nodesById.get(id)).filter((n): n is Node => n != null),
    [selected, nodesById],
  );

  // Recent history nodes (excluding those already in selection to avoid dup UI)
  const historyNodes = useMemo(() => {
    return visited
      .slice(0, HISTORY_DIGEST_LIMIT)
      .map((id) => nodesById.get(id))
      .filter((n): n is Node => n != null);
  }, [visited, nodesById]);

  const digest = useMemo(
    () => computeDigest(selectedNodes, nodesById, byParent, historyNodes),
    [selectedNodes, historyNodes, nodesById, byParent],
  );

  const hasDigestData =
    digest.temporalSpan !== null ||
    digest.topLocations.length > 0 ||
    digest.topEntities.length > 0;

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <p style={{ ...S.heading, margin: 0 }}>
            selection · {selected.size}
            {selected.size === 0 && <span style={{ ...S.empty, fontStyle: 'normal', marginLeft: 6, fontSize: 9 }}>shift+click to add</span>}
          </p>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {selected.size > 0 && (
              <button
                title={filterToSelection ? 'Show all nodes' : 'Filter frames to selection'}
                style={{
                  ...S.navBtn, width: 'auto', fontSize: 10, padding: '1px 6px',
                  borderRadius: 3, border: 'var(--border-width) solid',
                  borderColor: filterToSelection ? 'var(--accent)' : 'var(--border)',
                  color: filterToSelection ? 'var(--accent)' : 'var(--text-muted)',
                  background: filterToSelection ? 'var(--accent-dim)' : 'none',
                }}
                onClick={() => filterStore.getState().setFilterToSelection(!filterToSelection)}
              >
                ⊠ pin
              </button>
            )}
            {selected.size > 0 && (
              <button
                style={{ ...S.navBtn, width: 'auto', fontSize: 10, color: 'var(--text-muted)', padding: '0 2px' }}
                onClick={() => {
                  selectionStore.getState().clear();
                  filterStore.getState().setFilterToSelection(false);
                }}
              >
                clear
              </button>
            )}
          </div>
        </div>
        {selected.size === 0
          ? <span style={S.empty}>Nothing selected</span>
          : selected.size > 8
          ? <SelectionSummary nodes={selectedNodes} onClearAll={() => selectionStore.getState().clear()} />
          : selectedNodes.map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  style={{ ...S.navBtn, opacity: n.id === focused ? 1 : 0.8, flex: 1 }}
                  onClick={() => selectionStore.getState().selectOnly(n.id)}
                >
                  <div style={S.row}>
                    <span style={{ ...S.label, color: n.id === focused ? 'var(--selected)' : 'var(--text)' }}>
                      {deriveLabel(n, 45)}
                    </span>
                    <span style={S.badge}>{n.type}</span>
                  </div>
                </button>
                <button
                  title="Remove from selection"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: '0 3px', lineHeight: 1, flexShrink: 0 }}
                  onClick={() => selectionStore.getState().toggle(n.id)}
                >
                  ×
                </button>
              </div>
            ))}
      </div>

      {/* ── Context digest ── */}
      {/* Shown whenever there is selection or history — always populated context */}
      {(selectedNodes.length > 0 || historyNodes.length > 0) && (
        <div style={S.section}>
          <p style={S.heading}>context digest</p>
          {hasDigestData
            ? <DigestView digest={digest} selectionCount={selectedNodes.length} />
            : <span style={S.empty}>No annotations found in selection or history</span>
          }
        </div>
      )}
    </div>
  );
}

function SelectionSummary({ nodes, onClearAll }: { nodes: Node[]; onClearAll: () => void }) {
  const byType = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(byType).map(([type, count]) => (
          <span key={type} style={S.chip}>{count} {type}{count !== 1 ? 's' : ''}</span>
        ))}
      </div>
      <button
        style={{ ...S.navBtn, width: 'auto', alignSelf: 'flex-start', fontSize: 10, color: 'var(--text-muted)' }}
        onClick={onClearAll}
      >
        clear all ×
      </button>
    </div>
  );
}

function DigestView({ digest, selectionCount }: { digest: Digest; selectionCount: number }) {
  // Build a human-readable source hint
  const parts: string[] = [];
  if (selectionCount > 0) parts.push(`${selectionCount} selected`);
  if (digest.historyNodeCount > 0) parts.push(`${digest.historyNodeCount} from history`);
  if (digest.derivedFromDescendants > 0) parts.push(`via descendants`);

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
          <span style={S.digestVal}>{digest.topLocations.map((l) => l.name).join(', ')}</span>
        </div>
      )}
      {digest.topEntities.length > 0 && (
        <div style={S.digestKv}>
          <span style={S.digestKey}>entities</span>
          <span style={S.digestVal}>{digest.topEntities.map((e) => e.name).join(', ')}</span>
        </div>
      )}
      {parts.length > 0 && (
        <div style={S.digestHint}>{parts.join(' · ')}</div>
      )}
    </div>
  );
}
