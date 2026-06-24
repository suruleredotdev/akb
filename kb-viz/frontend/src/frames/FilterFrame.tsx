import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { filterStore } from '../state/filter-store';
import type { FrameProps } from './registry';

const ANNOTATION_TYPES = [
  { key: 'geographic', label: 'geo', color: 'var(--loc)', bg: 'var(--loc-bg)' },
  { key: 'temporal',   label: 'time', color: 'var(--time)', bg: 'var(--time-bg)' },
  { key: 'entity_ref', label: 'entity', color: 'var(--person)', bg: 'var(--person-bg)' },
  { key: 'numeric',    label: 'numeric', color: 'var(--keyword)', bg: 'var(--keyword-bg)' },
];

const S: Record<string, React.CSSProperties> = {
  frame:     { padding: '10px 12px', overflowY: 'auto', height: '100%', background: 'var(--surface)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 },
  heading:   { fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: 'var(--title-color)', margin: 0 },
  section:   { display: 'flex', flexDirection: 'column', gap: 6 },
  subHead:   { fontSize: 10, color: 'var(--title-color)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontWeight: 600 },
};

export function FilterFrame(_props: FrameProps) {
  const manifest      = useStore(dataStore, (s) => s.manifest);
  const totalNodes    = useStore(dataStore, (s) => s.nodes.size);
  const typeFilter    = useStore(filterStore, (s) => s.typeFilter);
  const annotTypes    = useStore(filterStore, (s) => s.annotationTypes);
  const textQuery     = useStore(filterStore, (s) => s.textQuery);
  const dateRange     = useStore(filterStore, (s) => s.dateRange);
  const activeIds     = useStore(filterStore, (s) => s.activeIds);

  const nodeTypes = manifest?.node_types ?? [];
  const isFiltered = typeFilter.size > 0 || annotTypes.size > 0 || !!textQuery || !!dateRange;

  return (
    <div style={S.frame}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={S.heading}>filters</p>
        <span style={{ fontSize: 11, color: isFiltered ? 'var(--accent)' : 'var(--text-dim)' }}>
          {activeIds.size}/{totalNodes}
          {isFiltered && (
            <button
              onClick={() => filterStore.getState().reset()}
              style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              clear ×
            </button>
          )}
        </span>
      </div>

      {/* Text search */}
      <div style={S.section}>
        <span style={S.subHead}>text search</span>
        <input
          type="text"
          value={textQuery}
          onChange={(e) => filterStore.getState().setTextQuery(e.target.value)}
          placeholder="filter by content…"
          style={{
            width: '100%', background: 'var(--bg)', color: 'var(--text)',
            border: 'var(--border-width) solid var(--border)', borderRadius: 4,
            padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Node type filter */}
      {nodeTypes.length > 0 && (
        <div style={S.section}>
          <span style={S.subHead}>node type</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {nodeTypes.map((nt) => {
              const active = typeFilter.has(nt.id);
              return (
                <label key={nt.id} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => {
                      const next = new Set(typeFilter);
                      if (active) next.delete(nt.id);
                      else next.add(nt.id);
                      filterStore.getState().setTypeFilter(next);
                    }}
                    style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, color: active ? 'var(--text)' : 'var(--text-dim)' }}>{nt.id}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Annotation type filter */}
      <div style={S.section}>
        <span style={S.subHead}>has annotation</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {ANNOTATION_TYPES.map(({ key, label, color, bg }) => {
            const active = annotTypes.has(key);
            return (
              <button
                key={key}
                onClick={() => filterStore.getState().toggleAnnotationType(key)}
                style={{
                  fontSize: 10, padding: '2px 9px', borderRadius: 9999, cursor: 'pointer',
                  border: 'var(--border-width) solid',
                  borderColor: active ? color : 'var(--border)',
                  background: active ? bg : 'none',
                  color: active ? color : 'var(--text-muted)',
                  transition: 'background 120ms, color 120ms, border-color 120ms',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active date range */}
      {dateRange && (
        <div style={S.section}>
          <span style={S.subHead}>date range</span>
          <div style={{ fontSize: 11, color: 'var(--time)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>
              {new Date(dateRange.startMs).getUTCFullYear()}
              {' → '}
              {new Date(dateRange.endMs).getUTCFullYear()}
            </span>
            <button
              onClick={() => filterStore.getState().setDateRange(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, padding: 0, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
