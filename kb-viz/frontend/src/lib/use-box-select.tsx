import { useCallback, useRef, useState } from 'react';
import type { Deck } from '@deck.gl/core';

export interface ScreenRect {
  x: number;   // left edge in px (within container)
  y: number;   // top edge in px
  width: number;
  height: number;
  shift: boolean;
}

/**
 * Enables Shift+drag box-select on a deck.gl canvas.
 *
 * Usage:
 *   const { dragRect, deckRef, onMouseDown } = useBoxSelect({ onSelect });
 *
 *   <div onMouseDown={onMouseDown} style={{ position: 'relative' }}>
 *     <DeckGL ref={deckRef} ... />
 *     {dragRect && <BoxSelectOverlay rect={dragRect} />}
 *   </div>
 *
 * When the user releases the mouse after a shift-drag, `onSelect` is called
 * with all pickable object IDs inside the box (via deck.pickObjects).
 * `extractId` should extract a node ID string from a deck.gl data object.
 */
export function useBoxSelect<T>(opts: {
  extractId: (obj: T) => string | undefined;
  onSelect: (ids: string[], shift: boolean) => void;
}) {
  const deckRef = useRef<Deck | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const [dragRect, setDragRect] = useState<ScreenRect | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStart.current = { x, y, shift: e.shiftKey };
    setDragRect({ x, y, width: 0, height: 0, shift: e.shiftKey });

    const container = e.currentTarget;

    const onMove = (me: MouseEvent) => {
      if (!dragStart.current) return;
      const cr = container.getBoundingClientRect();
      const cx = me.clientX - cr.left;
      const cy = me.clientY - cr.top;
      setDragRect({
        x: Math.min(dragStart.current.x, cx),
        y: Math.min(dragStart.current.y, cy),
        width: Math.abs(cx - dragStart.current.x),
        height: Math.abs(cy - dragStart.current.y),
        shift: dragStart.current.shift,
      });
    };

    const onUp = (me: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (!dragStart.current) return;

      const cr = container.getBoundingClientRect();
      const ex = me.clientX - cr.left;
      const ey = me.clientY - cr.top;
      const rx = Math.min(dragStart.current.x, ex);
      const ry = Math.min(dragStart.current.y, ey);
      const rw = Math.abs(ex - dragStart.current.x);
      const rh = Math.abs(ey - dragStart.current.y);
      const wasShift = dragStart.current.shift;

      dragStart.current = null;
      setDragRect(null);

      // Only trigger if dragged enough to form a meaningful box
      if (rw < 4 || rh < 4) return;

      // Use deck.pickObjects to find all objects in the box
      const deck = deckRef.current as (Deck & { pickObjects?: (opts: { x: number; y: number; width: number; height: number }) => Array<{ object: T }> }) | null;
      if (!deck?.pickObjects) return;

      const picks = deck.pickObjects({ x: rx, y: ry, width: rw, height: rh });
      const ids = picks
        .map((p) => opts.extractId(p.object))
        .filter((id): id is string => id != null);
      if (ids.length > 0) opts.onSelect(ids, wasShift);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [opts]);

  return { deckRef, containerRef, dragRect, onMouseDown };
}

/** Transparent blue overlay rectangle drawn during box-select. */
export function BoxSelectOverlay({ rect }: { rect: ScreenRect }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: '1.5px solid rgba(44, 167, 173, 0.8)',
        background: 'rgba(44, 167, 173, 0.08)',
        pointerEvents: 'none',
        zIndex: 20,
        boxSizing: 'border-box',
      }}
    />
  );
}
