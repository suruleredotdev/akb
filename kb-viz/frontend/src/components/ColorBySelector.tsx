import { useStore } from '../lib/use-store';
import { viewStore } from '../state/view-store';
import type { ColorBy } from '../lib/color-encoder';

const OPTIONS: { value: ColorBy; label: string }[] = [
  { value: 'document', label: 'color: document' },
  { value: 'type', label: 'color: type' },
];

export function ColorBySelector() {
  const colorBy = useStore(viewStore, (s) => s.colorBy);
  return (
    <select
      className="level-select"
      value={colorBy}
      onChange={(e) => viewStore.getState().setColorBy(e.target.value as ColorBy)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
