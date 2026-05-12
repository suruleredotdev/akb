import { describe, it, expect } from 'vitest';
import { projectTimeline } from '../../projection/projectors/timeline';
import type { Node } from '../../types/manifest';

const base = (overrides: Partial<Node>): Node => ({
  id: 'n1', type: 'chunk', child_ids: [], properties: {}, annotations: [], ...overrides,
});

describe('projectTimeline', () => {
  it('returns empty map when no temporal annotations', () => {
    const node = base({});
    expect(projectTimeline([node], new Map([['n1', node]])).size).toBe(0);
  });

  it('extracts epoch ms from iso_start', () => {
    const node = base({
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '1990-06-15', granularity: 'day' } }],
    });
    const result = projectTimeline([node], new Map([['n1', node]]));
    expect(result.get('n1')?.[0]).toBe(Date.parse('1990-06-15'));
  });

  it('falls back to summary centroid (seconds → ms)', () => {
    const t = Date.parse('2000-01-01') / 1000;
    const node = base({
      annotations: [],
      summary: { descendant_count: 0, child_type_counts: {}, frame_summaries: { timeline: { count: 1, centroid: [t] } } },
    });
    const result = projectTimeline([node], new Map([['n1', node]]));
    expect(result.get('n1')?.[0]).toBe(t * 1000);
  });

  it('prefers direct annotation over summary centroid', () => {
    const direct = Date.parse('1850-01-01');
    const node = base({
      annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '1850-01-01', granularity: 'year' } }],
      summary: { descendant_count: 0, child_type_counts: {}, frame_summaries: { timeline: { count: 1, centroid: [999999999] } } },
    });
    const result = projectTimeline([node], new Map([['n1', node]]));
    expect(result.get('n1')?.[0]).toBe(direct);
  });

  it('falls back to mean of descendant temporal annotations', () => {
    const t1 = Date.parse('1900-01-01');
    const t2 = Date.parse('1920-01-01');
    const child1 = base({ id: 'c1', annotations: [{ id: 'a1', type: 'temporal', value: { kind: 'temporal', iso_start: '1900-01-01', granularity: 'year' } }] });
    const child2 = base({ id: 'c2', annotations: [{ id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '1920-01-01', granularity: 'year' } }] });
    const parent = base({ id: 'p1', annotations: [], child_ids: ['c1', 'c2'] });
    const all = new Map([['c1', child1], ['c2', child2], ['p1', parent]]);
    const result = projectTimeline([parent], all);
    expect(result.get('p1')?.[0]).toBe((t1 + t2) / 2);
  });
});
