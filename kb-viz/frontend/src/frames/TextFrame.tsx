import type { ReactNode } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore, getAncestors } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore, type Level } from '../state/view-store';
import {
  isEntityRef,
  isGeographic,
  isNumeric,
  isTemporal,
  type Annotation,
  type Node,
  type PropertyValue,
} from '../types/manifest';

import { deriveLabel } from '../lib/derive-label';
import type { FrameProps } from './registry';
export function TextFrame(_props: FrameProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const focused = useStore(selectionStore, (s) => s.focused);

  if (!focused) {
    return (
      <div className="text-frame">
        <div className="frame-empty">
          Select a node from any frame to see its text and annotations
        </div>
      </div>
    );
  }
  const node = nodesById.get(focused);
  if (!node) {
    return (
      <div className="text-frame">
        <div className="frame-empty">Node not found: {focused}</div>
      </div>
    );
  }

  return (
    <div className="text-frame">
      <h3 title={node.id}>{deriveLabel(node)}</h3>
      <div className="meta">
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--text-muted)', userSelect: 'all' }}>{node.id}</span>
        {' · '}type: <strong>{node.type}</strong>
        {node.annotations.length > 0 && <> · {node.annotations.length} annotations</>}
      </div>
      <NodeNav node={node} nodesById={nodesById} />
      {node.text ? (
        <div className="body">{renderHighlighted(node)}</div>
      ) : (
        <div className="body" style={{ color: '#6b7280' }}>(no text)</div>
      )}
      <PropertiesList node={node} />
      <AnnotationsList node={node} />
    </div>
  );
}

function NodeNav({ node, nodesById }: { node: Node; nodesById: Map<string, Node> }) {
  const manifest = useStore(dataStore, (s) => s.manifest);

  const ancestors = getAncestors(nodesById, node.id);
  const children = node.child_ids
    .map((id) => nodesById.get(id))
    .filter((n): n is Node => n != null);

  const nodeTypeDef = manifest?.node_types.find((t) => t.id === node.type);
  const childTypeName = nodeTypeDef?.child_types[0] ?? 'child';

  if (ancestors.length === 0 && children.length === 0) return null;

  return (
    <div className="node-nav">
      {ancestors.length > 0 && (
        <div className="nav-section">
          <span className="nav-label">ancestors</span>
          <div className="nav-chain">
            {[...ancestors].reverse().map((anc, i) => (
              <span key={anc.id} className="nav-chain-item">
                {i > 0 && <span className="nav-sep">›</span>}
                <button
                  className="nav-link"
                  title={anc.id}
                  onClick={() => {
                    selectionStore.getState().selectOnly(anc.id);
                    viewStore.getState().setLevel(anc.type as Level);
                  }}
                >
                  <span className="type-badge">{anc.type}</span>
                  {deriveLabel(anc, 40)}
                </button>
              </span>
            ))}
            <span className="nav-sep">›</span>
            <span className="nav-current" title={node.id}>{deriveLabel(node, 40)}</span>
          </div>
        </div>
      )}
      {children.length > 0 && (
        <div className="nav-section">
          <div className="nav-children-header">
            <span className="nav-label">{children.length} {childTypeName}{children.length !== 1 ? 's' : ''}</span>
            <button
              className="drill-btn"
              onClick={() => {
                viewStore.getState().drillInto(node.id, childTypeName as Level);
              }}
            >
              scope to these
            </button>
          </div>
          <div className="child-list">
            {children.slice(0, 6).map((child) => (
              <button
                key={child.id}
                className="nav-link child-link"
                title={child.id}
                onClick={() => {
                  selectionStore.getState().selectOnly(child.id);
                  viewStore.getState().setLevel(child.type as Level);
                }}
              >
                {deriveLabel(child, 40)}
              </button>
            ))}
            {children.length > 6 && (
              <span style={{ color: '#6b7280', fontSize: 11 }}>
                +{children.length - 6} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function renderHighlighted(node: Node): ReactNode {
  const text = node.text ?? '';
  const anns = node.annotations
    .filter((a): a is Annotation & { span: [number, number] } => a.span != null)
    .sort((a, b) => a.span[0] - b.span[0]);
  if (anns.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  anns.forEach((a, i) => {
    const [s, e] = a.span;
    if (s < cursor) return;
    if (s > cursor) parts.push(text.slice(cursor, s));
    parts.push(
      <span key={i} className={spanClass(a)} title={a.type}>
        {text.slice(s, e)}
      </span>,
    );
    cursor = e;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function spanClass(a: Annotation): string {
  switch (a.type) {
    case 'geographic': return 'span-geo';
    case 'temporal': return 'span-time';
    case 'entity_ref': return 'span-entity';
    default: return '';
  }
}

function PropertiesList({ node }: { node: Node }) {
  const entries = Object.entries(node.properties);
  if (entries.length === 0) return null;
  return (
    <>
      <h4>Properties</h4>
      <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
        {entries.map(([k, v]) => (
          <div key={k}>
            <span style={{ color: '#9ca3af' }}>{k}:</span> {formatProp(v)}
          </div>
        ))}
      </div>
    </>
  );
}

function formatProp(v: PropertyValue): string {
  if (v.kind === 'scalar') {
    const num = typeof v.value === 'number' ? v.value : Number(v.value);
    const fmt = Number.isFinite(num)
      ? Math.abs(num) < 0.001 || Math.abs(num) > 1e6
        ? num.toExponential(2)
        : num.toFixed(num % 1 === 0 ? 0 : 3)
      : String(v.value);
    return `${fmt}${v.unit ? ' ' + v.unit : ''}`;
  }
  if (v.kind === 'categorical') return v.value;
  if (v.kind === 'vector') return `[${v.dim}d vector]`;
  if (v.kind === 'interval') return `[${v.min}, ${v.max}]${v.unit ? ' ' + v.unit : ''}`;
  return JSON.stringify(v);
}

function AnnotationsList({ node }: { node: Node }) {
  if (node.annotations.length === 0) return null;
  return (
    <>
      <h4>Annotations</h4>
      <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
        {node.annotations.map((a, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: '#9ca3af' }}>{a.type}:</span>{' '}
            {formatAnnotation(a)}
          </div>
        ))}
      </div>
    </>
  );
}

function formatAnnotation(a: Annotation): string {
  const v = a.value;
  if (isGeographic(v)) return `${v.name ?? '(unnamed)'} (${v.lat.toFixed(2)}, ${v.lng.toFixed(2)})`;
  if (isTemporal(v)) return v.iso_end ? `${v.iso_start} → ${v.iso_end}` : v.iso_start;
  if (isEntityRef(v)) return `${v.name ?? v.entity_id}${v.entity_type ? ` (${v.entity_type})` : ''}`;
  if (isNumeric(v)) return `${v.value}${v.unit ? ' ' + v.unit : ''}`;
  return JSON.stringify(v);
}
