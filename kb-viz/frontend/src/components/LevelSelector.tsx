import { useStore } from '../lib/use-store';
import { viewStore, type Level } from '../state/view-store';

const LEVELS: Level[] = ['document', 'chunk', 'expression'];

export function LevelSelector() {
  const level = useStore(viewStore, (s) => s.level);
  return (
    <select
      className="level-select"
      value={level}
      onChange={(e) => viewStore.getState().setLevel(e.target.value as Level)}
    >
      {LEVELS.map((l) => (
        <option key={l} value={l}>level: {l}</option>
      ))}
    </select>
  );
}
