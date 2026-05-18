import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../lib/use-store';
import { selectionStore } from '../state/selection-store';
import { dataStore } from '../state/data-store';
import { deriveLabel } from '../lib/derive-label';

export function NodeTooltip() {
  const hovered = useStore(selectionStore, (s) => s.hovered);
  const nodes = useStore(dataStore, (s) => s.nodes);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY });
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!hovered) return null;
  const node = nodes.get(hovered);
  if (!node) return null;

  const label = deriveLabel(node, 60);
  const preview = node.text?.trim().replace(/\s+/g, ' ').slice(0, 120) ?? null;

  const geoCnt  = node.annotations.filter((a) => a.value.kind === 'geographic').length;
  const timeCnt = node.annotations.filter((a) => a.value.kind === 'temporal').length;
  const entCnt  = node.annotations.filter((a) => a.value.kind === 'entity_ref').length;

  // Keep tooltip on screen
  const offsetX = pos.x > window.innerWidth  - 300 ? -290 : 14;
  const offsetY = pos.y > window.innerHeight - 120 ? -110 :  14;

  return createPortal(
    <div
      className="node-tooltip"
      style={{ left: pos.x + offsetX, top: pos.y + offsetY }}
    >
      <div className="tt-label">{label}</div>
      {preview && <div className="tt-preview">{preview}</div>}
      <div className="tt-badges">
        <span className="badge badge-loc"    style={{ display: geoCnt  ? undefined : 'none' }}>🌍 {geoCnt}</span>
        <span className="badge badge-time"   style={{ display: timeCnt ? undefined : 'none' }}>📅 {timeCnt}</span>
        <span className="badge badge-person" style={{ display: entCnt  ? undefined : 'none' }}>👤 {entCnt}</span>
      </div>
    </div>,
    document.body,
  );
}
