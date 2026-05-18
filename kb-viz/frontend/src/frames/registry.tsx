import type { ComponentType } from 'react';
import type { FrameType } from '../state/layout-store';

export interface FrameProps {
  paneId: string;
  width: number;
  height: number;
}

const registry = new Map<FrameType, ComponentType<FrameProps>>();

export function registerFrame(type: FrameType, Component: ComponentType<FrameProps>) {
  registry.set(type, Component);
}

function Placeholder({ paneId }: FrameProps) {
  return <div className="frame-empty">{paneId} — frame not registered</div>;
}

export function getFrame(type: FrameType): ComponentType<FrameProps> {
  return registry.get(type) ?? Placeholder;
}
