import { describe, it, expect } from 'vitest';
import { deriveLabel } from '../lib/derive-label';
import type { Node } from '../types/manifest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Node> & { id: string }): Node {
  return {
    type: 'expression',
    parent_id: null,
    child_ids: [],
    text: null,
    embedding: null,
    embedding_model: null,
    properties: {},
    annotations: [],
    summary: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Priority chain
// ---------------------------------------------------------------------------

describe('deriveLabel – priority chain', () => {
  it('1st priority: properties.title (categorical)', () => {
    const node = makeNode({
      id: 'n1',
      text: 'some text',
      properties: {
        title:  { kind: 'categorical', value: 'My Title' },
        label:  { kind: 'categorical', value: 'My Label' },
        source: { kind: 'categorical', value: '/path/to/file.pdf' },
      },
    });
    expect(deriveLabel(node)).toBe('My Title');
  });

  it('2nd priority: properties.label (categorical) — used by document nodes', () => {
    // Document nodes have properties.label but no title/source/text
    const node = makeNode({
      id: 'doc:258c990dc4ee6c7d',
      type: 'document',
      properties: {
        label:       { kind: 'categorical', value: 'Boko Haram Political Economy' },
        ingested_at: { kind: 'scalar', value: 1777526922.3 },
        chunk_count: { kind: 'scalar', value: 6 },
      },
    });
    expect(deriveLabel(node)).toBe('Boko Haram Political Economy');
  });

  it('2nd priority: properties.label wins over source and text', () => {
    const node = makeNode({
      id: 'n1',
      text: 'some text',
      properties: {
        label:  { kind: 'categorical', value: 'Doc Label' },
        source: { kind: 'categorical', value: '/path/to/file.pdf' },
      },
    });
    expect(deriveLabel(node)).toBe('Doc Label');
  });

  it('3rd priority: properties.source → filename only (categorical)', () => {
    const node = makeNode({
      id: 'n1',
      text: 'some text',
      properties: {
        source: { kind: 'categorical', value: '/some/path/document.pdf' },
      },
    });
    expect(deriveLabel(node)).toBe('document.pdf');
  });

  it('4th priority: node.text excerpt', () => {
    const node = makeNode({
      id: 'n1',
      text: 'The quick brown fox',
      properties: {},
    });
    expect(deriveLabel(node)).toBe('The quick brown fox');
  });

  it('5th priority (last resort): node.id', () => {
    const node = makeNode({
      id: 'doc:258c990dc4ee6c7d',
      properties: {},
    });
    expect(deriveLabel(node)).toBe('doc:258c990dc4ee6c7d');
  });
});

// ---------------------------------------------------------------------------
// properties.title edge cases
// ---------------------------------------------------------------------------

describe('deriveLabel – title property', () => {
  it('ignores title if kind is not categorical', () => {
    const node = makeNode({
      id: 'n1',
      text: 'fallback text',
      properties: {
        title: { kind: 'scalar', value: 42 },
      },
    });
    expect(deriveLabel(node)).toBe('fallback text');
  });
});

// ---------------------------------------------------------------------------
// properties.label edge cases (document nodes)
// ---------------------------------------------------------------------------

describe('deriveLabel – label property', () => {
  it('ignores label if kind is not categorical', () => {
    const node = makeNode({
      id: 'n1',
      text: 'fallback text',
      properties: {
        label: { kind: 'scalar', value: 99 },
      },
    });
    expect(deriveLabel(node)).toBe('fallback text');
  });

  it('all five real document nodes from the manifest get meaningful labels', () => {
    const docs: Array<[string, string]> = [
      ['doc:258c990dc4ee6c7d', 'Boko Haram Political Economy'],
      ['doc:f66bb697585346e8', 'Decentralised Finance Africa'],
      ['doc:146871833cd2722a', 'Kanem Bornu Empire'],
      ['doc:3f5cd362681faadc', 'Lake Chad Climate'],
      ['doc:b42697ad84f67407', 'Water Harvesting Sahel'],
    ];
    for (const [id, expectedLabel] of docs) {
      const node = makeNode({
        id,
        type: 'document',
        properties: { label: { kind: 'categorical', value: expectedLabel } },
      });
      expect(deriveLabel(node)).toBe(expectedLabel);
      // Must NOT fall back to the raw ID
      expect(deriveLabel(node)).not.toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------
// properties.source edge cases
// ---------------------------------------------------------------------------

describe('deriveLabel – source property', () => {
  it('returns only the filename for a Unix path', () => {
    const node = makeNode({
      id: 'n1',
      properties: { source: { kind: 'categorical', value: '/home/user/docs/report.pdf' } },
    });
    expect(deriveLabel(node)).toBe('report.pdf');
  });

  it('returns only the filename for a Windows-style path (backslash)', () => {
    const node = makeNode({
      id: 'n1',
      properties: { source: { kind: 'categorical', value: 'C:\\Users\\docs\\report.pdf' } },
    });
    expect(deriveLabel(node)).toBe('report.pdf');
  });

  it('returns only the filename for a URL', () => {
    const node = makeNode({
      id: 'n1',
      properties: { source: { kind: 'categorical', value: 'https://example.com/papers/study.pdf' } },
    });
    expect(deriveLabel(node)).toBe('study.pdf');
  });

  it('returns the full value when source has no path separator', () => {
    const node = makeNode({
      id: 'n1',
      properties: { source: { kind: 'categorical', value: 'justfilename.txt' } },
    });
    expect(deriveLabel(node)).toBe('justfilename.txt');
  });

  it('ignores source if kind is not categorical', () => {
    const node = makeNode({
      id: 'n1',
      text: 'fallback',
      properties: { source: { kind: 'scalar', value: 0 } },
    });
    expect(deriveLabel(node)).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// text truncation
// ---------------------------------------------------------------------------

describe('deriveLabel – text truncation', () => {
  it('returns full text when it fits within maxLen', () => {
    const node = makeNode({ id: 'n1', text: 'Short text' });
    expect(deriveLabel(node, 80)).toBe('Short text');
  });

  it('truncates at a word boundary and appends ellipsis', () => {
    const node = makeNode({ id: 'n1', text: 'one two three four five' });
    // maxLen=10 → "one two…" (cuts at last space before 10)
    const result = deriveLabel(node, 10);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(11); // maxLen + ellipsis char
  });

  it('hard-cuts when there is no space before maxLen', () => {
    const node = makeNode({ id: 'n1', text: 'abcdefghijklmnopqrstuvwxyz' });
    const result = deriveLabel(node, 10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('collapses internal whitespace before truncating', () => {
    const node = makeNode({ id: 'n1', text: 'foo   bar\n\nbaz' });
    expect(deriveLabel(node, 80)).toBe('foo bar baz');
  });

  it('respects custom maxLen = 20', () => {
    const node = makeNode({ id: 'n1', text: 'The quick brown fox jumps over the lazy dog' });
    const result = deriveLabel(node, 20);
    expect(result.endsWith('…')).toBe(true);
    // The non-ellipsis portion should be ≤ 20 chars
    expect(result.replace('…', '').length).toBeLessThanOrEqual(20);
  });

  it('default maxLen is 80', () => {
    const text = 'x'.repeat(100);
    const result = deriveLabel(makeNode({ id: 'n1', text }));
    expect(result.endsWith('…')).toBe(true);
  });
});
