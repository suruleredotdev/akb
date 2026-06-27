import { useEffect, useRef } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { deriveLabel } from '../lib/derive-label';

export interface PickMenuState {
  x: number;
  y: number;
  ids: string[];
}

interface PickMenuProps {
  menu: PickMenuState;
  onPick: (id: string, shift: boolean) => void;
  onClose: () => void;
}

export function PickMenu({ menu, onPick, onClose }: PickMenuProps) {
  const nodesById = useStore(dataStore, (s) => s.nodes);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: menu.x,
        top: menu.y,
        zIndex: 20,
        background: 'var(--surface-elevated, #1a1a2e)',
        border: '1px solid var(--border, #333)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 160,
        maxWidth: 300,
        maxHeight: 220,
        overflowY: 'auto',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        fontSize: 12,
      }}
    >
      <div style={{
        padding: '2px 8px 4px',
        color: 'var(--text-dim, #888)',
        fontSize: 10,
        borderBottom: '1px solid var(--border, #333)',
      }}>
        {menu.ids.length} overlapping nodes
      </div>
      {menu.ids.map((id) => {
        const node = nodesById.get(id);
        const label = node ? deriveLabel(node, 50) : id.slice(0, 20);
        return (
          <button
            key={id}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '4px 8px',
              background: 'none',
              border: 'none',
              color: 'var(--text, #e0e0e0)',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            onClick={(e) => onPick(id, e.shiftKey)}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--surface-hover, #2a2a4e)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
