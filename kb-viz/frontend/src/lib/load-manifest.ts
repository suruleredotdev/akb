import type { Manifest } from '../types/manifest';

export async function loadManifest(url: string): Promise<Manifest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.version !== '1' || !Array.isArray(data.nodes)) {
    throw new Error('Invalid manifest: expected version "1" with nodes array');
  }
  return data as Manifest;
}
