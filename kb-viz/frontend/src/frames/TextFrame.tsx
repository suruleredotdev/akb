import type { ReactNode } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import {
  isEntityRef,
  isGeographic,
  isNumeric,
  isTemporal,
  type Annotation,
  type Node,
  type PropertyValue,
} from '../types/manifest';

export function TextFrame() {
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
      <h3>{node.id}</h3>
      <div className="meta">
        type: <strong>{node.type}</strong>
        {node.parent_id && <> · parent: {node.parent_id}</>}
        {node.child_ids.length > 0 && <> · {node.child_ids.length} children</>}
        {node.annotations.length > 0 && <> · {node.annotations.length} annotations</>}
      </div>
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
    if (s < cursor) return; // skip overlaps for MVP
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
  if (isGeographic(v)) {
    return `${v.name ?? '(unnamed)'} (${v.lat.toFixed(2)}, ${v.lng.toFixed(2)})`;
  }
  if (isTemporal(v)) {
    return v.iso_end ? `${v.iso_start} → ${v.iso_end}` : v.iso_start;
  }
  if (isEntityRef(v)) {
    return `${v.name ?? v.entity_id}${v.entity_type ? ` (${v.entity_type})` : ''}`;
  }
  if (isNumeric(v)) {
    return `${v.value}${v.unit ? ' ' + v.unit : ''}`;
  }
  return JSON.stringify(v);
}
