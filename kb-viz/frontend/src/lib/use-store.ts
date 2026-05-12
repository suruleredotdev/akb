import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';

export function useStore<T, S>(
  store: StoreApi<T>,
  selector: (state: T) => S,
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
