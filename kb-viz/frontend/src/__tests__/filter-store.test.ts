import { describe, it, expect, beforeEach } from 'vitest';
import { filterStore } from '../state/filter-store';
import { dataStore } from '../state/data-store';
import type { Manifest } from '../types/manifest';

// Minimal manifest fixture
const makeManifest = (): Manifest => ({
  version: '1',
  schema_id: 'test',
  node_types: [
    { id: 'document', parent_types: [], child_types: ['chunk'], display: { label: 'Document' } },
    { id: 'chunk', parent_types: ['document'], child_types: [], display: { label: 'Chunk' } },
  ],
  annotation_types: [],
  frames: [],
  nodes: [
    {
      id: 'doc1', type: 'document', child_ids: ['c1', 'c2'],
      properties: {}, annotations: [],
    },
    {
      id: 'c1', type: 'chunk', parent_id: 'doc1', child_ids: [],
      properties: {},
      annotations: [
        { id: 'a1', type: 'geographic', value: { kind: 'geographic', lat: 12, lng: 14 } },
        { id: 'a2', type: 'temporal', value: { kind: 'temporal', iso_start: '1990-01-01', granularity: 'year' } },
      ],
      text: 'Lake Chad basin water harvesting',
    },
    {
      id: 'c2', type: 'chunk', parent_id: 'doc1', child_ids: [],
      properties: {},
      annotations: [
        { id: 'a3', type: 'entity_ref', value: { kind: 'entity_ref', entity_id: 'e1', name: 'Nigeria' } },
      ],
      text: 'Boko Haram political economy',
    },
  ],
  edges: [],
});

beforeEach(() => {
  dataStore.getState().load(makeManifest());
  filterStore.getState().reset();
});

describe('filterStore', () => {
  it('activeIds contains all nodes after reset', () => {
    const ids = filterStore.getState().activeIds;
    expect(ids.size).toBe(3);
  });

  it('type filter limits to matching types', () => {
    filterStore.getState().setTypeFilter(new Set(['chunk']));
    const ids = filterStore.getState().activeIds;
    expect(ids.has('doc1')).toBe(false);
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
  });

  it('empty type filter shows all', () => {
    filterStore.getState().setTypeFilter(new Set(['chunk']));
    filterStore.getState().setTypeFilter(new Set());
    expect(filterStore.getState().activeIds.size).toBe(3);
  });

  it('annotation type filter shows only nodes with that annotation', () => {
    filterStore.getState().toggleAnnotationType('geographic');
    const ids = filterStore.getState().activeIds;
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(false);
    expect(ids.has('doc1')).toBe(false);
  });

  it('toggling same annotation type twice removes the filter', () => {
    filterStore.getState().toggleAnnotationType('geographic');
    filterStore.getState().toggleAnnotationType('geographic');
    expect(filterStore.getState().activeIds.size).toBe(3);
  });

  it('date range filter limits to nodes with temporal annotation in range', () => {
    const start = Date.parse('1985-01-01');
    const end = Date.parse('1995-01-01');
    filterStore.getState().setDateRange({ startMs: start, endMs: end });
    const ids = filterStore.getState().activeIds;
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(false);
  });

  it('date range outside annotation excludes node', () => {
    filterStore.getState().setDateRange({ startMs: Date.parse('2000-01-01'), endMs: Date.parse('2010-01-01') });
    expect(filterStore.getState().activeIds.has('c1')).toBe(false);
  });

  it('text query filters by node text', () => {
    filterStore.getState().setTextQuery('lake chad');
    const ids = filterStore.getState().activeIds;
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(false);
  });

  it('combined type + annotation filter is AND logic', () => {
    filterStore.getState().setTypeFilter(new Set(['chunk']));
    filterStore.getState().toggleAnnotationType('entity_ref');
    const ids = filterStore.getState().activeIds;
    expect(ids.size).toBe(1);
    expect(ids.has('c2')).toBe(true);
  });

  it('reset clears all predicates and restores all ids', () => {
    filterStore.getState().setTypeFilter(new Set(['chunk']));
    filterStore.getState().toggleAnnotationType('geographic');
    filterStore.getState().reset();
    expect(filterStore.getState().activeIds.size).toBe(3);
    expect(filterStore.getState().typeFilter.size).toBe(0);
    expect(filterStore.getState().annotationTypes.size).toBe(0);
  });
});
