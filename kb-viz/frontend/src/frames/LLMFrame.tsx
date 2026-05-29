import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../lib/use-store';
import { dataStore } from '../state/data-store';
import { selectionStore } from '../state/selection-store';
import { viewStore } from '../state/view-store';
import { historyStore } from '../state/history-store';
import { deriveLabel } from '../lib/derive-label';
import { computeDigest } from '../lib/compute-digest';
import type { Node, NodeId } from '../types/manifest';
import type { FrameProps } from './registry';

// ---------------------------------------------------------------------------
// Anthropic API types (local — no SDK dependency)
// ---------------------------------------------------------------------------

interface TextBlock    { type: 'text'; text: string; }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; }
interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// UI message types (for display)
// ---------------------------------------------------------------------------

interface DisplayMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: { name: string; summary: string }[];
  isStreaming?: boolean;
}

// ---------------------------------------------------------------------------
// Tool definitions exposed to the LLM
// ---------------------------------------------------------------------------

/** Maximum number of agentic tool-call turns before we stop the loop. */
const MAX_TOOL_TURNS = 15;

const TOOLS = [
  {
    name: 'get_nodes_content',
    description: 'Retrieve the full text and annotations for one or more nodes by ID. Use this to read node content before comparing or summarizing — prefer this over calling focus_node repeatedly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Node IDs to read (max 20)' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'search_nodes',
    description: 'Search nodes by text content or label (case-insensitive substring match). Returns matching node IDs and labels.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:     { type: 'string', description: 'Text to search for' },
        node_type: { type: 'string', description: 'Optional: filter by node type (document, chunk, expression)' },
        limit:     { type: 'number', description: 'Max results to return (default 20, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_similar_nodes',
    description: 'Find nodes semantically similar to a reference node using stored embeddings (cosine similarity). Only works if the reference node has an embedding.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id:        { type: 'string', description: 'Reference node ID' },
        node_type: { type: 'string', description: 'Optional: filter results by node type' },
        limit:     { type: 'number', description: 'Max results (default 10, max 30)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'select_nodes',
    description: 'Highlight one or more nodes across all visualization frames by selecting them. Use this to point the user to relevant items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Node IDs to select' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'focus_node',
    description: 'Focus a single node so its full text and annotations appear in the text panel. Use this to draw the user\'s attention to one specific node. To read multiple nodes, use get_nodes_content instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Node ID to focus' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_view_level',
    description: 'Change the visualization hierarchy level.',
    input_schema: {
      type: 'object' as const,
      properties: {
        level: { type: 'string', enum: ['document', 'chunk', 'expression'] },
      },
      required: ['level'],
    },
  },
];

// ---------------------------------------------------------------------------
// Execute a tool call → update UI state, return human-readable result
// ---------------------------------------------------------------------------

function executeTool(name: string, input: Record<string, unknown>, nodesById: Map<NodeId, Node>): string {
  switch (name) {
    case 'get_nodes_content': {
      const ids = ((input.ids as string[]) ?? []).slice(0, 20);
      if (ids.length === 0) return 'No node IDs provided.';
      const parts = ids.map((id) => {
        const n = nodesById.get(id);
        if (!n) return `[${id}]: not found`;
        const text = n.text ? n.text.slice(0, 1200) + (n.text.length > 1200 ? '…' : '') : '(no text)';
        const annSummary = n.annotations.length > 0
          ? `\nAnnotations (${n.annotations.length}): ${n.annotations.slice(0, 5).map((a) => a.type).join(', ')}`
          : '';
        return `[${id}] ${deriveLabel(n, 60)} (${n.type})\n${text}${annSummary}`;
      });
      return parts.join('\n\n---\n\n');
    }
    case 'search_nodes': {
      const query = ((input.query as string) ?? '').toLowerCase();
      if (!query) return 'No query provided.';
      const nodeType = input.node_type as string | undefined;
      const limit = Math.min(Number(input.limit ?? 20), 50);
      const results: Node[] = [];
      for (const [, node] of nodesById) {
        if (nodeType && node.type !== nodeType) continue;
        if (
          node.text?.toLowerCase().includes(query) ||
          deriveLabel(node).toLowerCase().includes(query)
        ) {
          results.push(node);
          if (results.length >= limit) break;
        }
      }
      if (results.length === 0) return `No nodes found matching "${input.query}".`;
      return `Found ${results.length} node(s) matching "${input.query}":\n` +
        results.map((n) => `- [${n.id}] ${deriveLabel(n, 60)} (${n.type})`).join('\n');
    }
    case 'find_similar_nodes': {
      const refId = input.id as string;
      const refNode = nodesById.get(refId);
      if (!refNode) return `Node ${refId} not found.`;
      if (!refNode.embedding?.length) return `Node ${refId} has no embedding — cannot compute similarity.`;
      const nodeType = input.node_type as string | undefined;
      const limit = Math.min(Number(input.limit ?? 10), 30);
      const refEmb = refNode.embedding;
      const refNorm = Math.sqrt(refEmb.reduce((s, v) => s + v * v, 0));
      const scored: { node: Node; score: number }[] = [];
      for (const [id, node] of nodesById) {
        if (id === refId) continue;
        if (nodeType && node.type !== nodeType) continue;
        if (!node.embedding || node.embedding.length !== refEmb.length) continue;
        const dot  = node.embedding.reduce((s, v, i) => s + v * refEmb[i], 0);
        const norm = Math.sqrt(node.embedding.reduce((s, v) => s + v * v, 0));
        scored.push({ node, score: dot / (refNorm * norm + 1e-8) });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit);
      if (top.length === 0) return 'No nodes with compatible embeddings found.';
      return `Top ${top.length} similar to "${deriveLabel(refNode, 40)}":\n` +
        top.map((s) => `- [${s.node.id}] ${deriveLabel(s.node, 60)} (${s.node.type}) — sim: ${s.score.toFixed(3)}`).join('\n');
    }
    case 'select_nodes': {
      const ids = (input.ids as string[]) ?? [];
      if (ids.length === 0) return 'No nodes to select.';
      selectionStore.getState().boxSelect(ids);
      const labels = ids.slice(0, 3).map((id) => deriveLabel(nodesById.get(id) ?? ({ id } as Node), 30));
      const extra = ids.length > 3 ? ` (+${ids.length - 3} more)` : '';
      return `Selected: ${labels.join(', ')}${extra}`;
    }
    case 'focus_node': {
      const id = input.id as string;
      selectionStore.getState().selectOnly(id);
      const label = deriveLabel(nodesById.get(id) ?? ({ id } as Node), 50);
      return `Focused: ${label}`;
    }
    case 'set_view_level': {
      const level = input.level as 'document' | 'chunk' | 'expression';
      viewStore.getState().setLevel(level);
      return `View level → ${level}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// Build system prompt from current selection / digest context
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  manifestLabel: string,
  byType: Map<string, NodeId[]>,
  nodesById: Map<NodeId, Node>,
  byParent: Map<NodeId, NodeId[]>,
  selected: Set<NodeId>,
  focused: NodeId | null,
  visited: NodeId[],
  level: string,
): string {
  const docCount   = byType.get('document')?.length ?? 0;
  const chunkCount = byType.get('chunk')?.length ?? 0;

  const selectedNodes = [...selected].map((id) => nodesById.get(id)).filter((n): n is Node => n != null);
  const historyNodes  = visited.slice(0, 20).map((id) => nodesById.get(id)).filter((n): n is Node => n != null);

  const digest = computeDigest(selectedNodes, nodesById, byParent, historyNodes);

  const selectionLines = selectedNodes.length === 0
    ? 'Nothing selected.'
    : selectedNodes.slice(0, 8).map((n) => `- [${n.type}] ${deriveLabel(n, 60)} (id: ${n.id})`).join('\n')
      + (selectedNodes.length > 8 ? `\n- …and ${selectedNodes.length - 8} more` : '');

  const focusedNode = focused ? nodesById.get(focused) : null;
  const focusedLines = focusedNode
    ? `Label: ${deriveLabel(focusedNode, 80)}\nType: ${focusedNode.type}\nText (first 1500 chars):\n${focusedNode.text?.slice(0, 1500) ?? '(no text)'}`
    : 'None.';

  const digestLines = [
    digest.temporalSpan ? `Temporal span: ${digest.temporalSpan.start} → ${digest.temporalSpan.end}` : null,
    digest.topLocations.length ? `Top locations: ${digest.topLocations.map((l) => l.name).join(', ')}` : null,
    digest.topEntities.length  ? `Top entities: ${digest.topEntities.map((e) => e.name).join(', ')}` : null,
  ].filter(Boolean).join('\n') || 'No digest data yet.';

  return `You are an AI assistant embedded in AKB — an archival knowledge-base visualizer.
Help the user explore, analyze, and understand their document collection.

## Knowledge Base: ${manifestLabel || 'Untitled'}
Documents: ${docCount} | Chunks: ${chunkCount} | Current level: ${level}

## Current Selection
${selectionLines}

## Focused Node
${focusedLines}

## Context Digest
${digestLines}

## Your tools
- get_nodes_content(ids): read full text + annotations for multiple nodes at once — use this first when comparing or summarizing several nodes
- search_nodes(query, node_type?, limit?): find nodes by text/label substring match — use this when the user asks about a topic or keyword
- find_similar_nodes(id, node_type?, limit?): find semantically similar nodes via embedding cosine similarity — use this to discover related content
- select_nodes(ids): highlight nodes across all frames
- focus_node(id): open a single node in the text panel (for drawing the user's attention; not for bulk reading)
- set_view_level(level): switch between document / chunk / expression

Prefer get_nodes_content over repeated focus_node calls when you need to read content. Use search_nodes to locate relevant nodes before reading them. Reference nodes by label in prose, use IDs only in tool calls. Briefly explain what you're doing before each tool use.`;
}

// ---------------------------------------------------------------------------
// Low-level SSE streaming call to Anthropic Messages API
// ---------------------------------------------------------------------------

async function* sseStream(apiKey: string, body: object): AsyncGenerator<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) yield line.slice(6);
    }
  }
}

// Call Claude and return the full content blocks (handles streaming internally).
// `onText` is called incrementally for live display.
async function callClaude(
  apiKey: string,
  messages: ApiMessage[],
  systemPrompt: string,
  onText: (delta: string) => void,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  let inputJsonBuf = '';

  for await (const data of sseStream(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages,
    tools: TOOLS,
  })) {
    if (data === '[DONE]') break;
    let event: Record<string, unknown>;
    try { event = JSON.parse(data); } catch { continue; }

    if (event.type === 'content_block_start') {
      const blk = event.content_block as Record<string, unknown>;
      if (blk.type === 'text') {
        blocks.push({ type: 'text', text: '' });
      } else if (blk.type === 'tool_use') {
        blocks.push({ type: 'tool_use', id: blk.id as string, name: blk.name as string, input: {} });
        inputJsonBuf = '';
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown>;
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text' && delta.type === 'text_delta') {
        (last as TextBlock).text += delta.text as string;
        onText(delta.text as string);
      } else if (last?.type === 'tool_use' && delta.type === 'input_json_delta') {
        inputJsonBuf += delta.partial_json as string;
      }
    } else if (event.type === 'content_block_stop') {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'tool_use') {
        try { (last as ToolUseBlock).input = JSON.parse(inputJsonBuf); } catch { /* keep empty */ }
        inputJsonBuf = '';
      }
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// API key hook (localStorage only, never in React state tree)
// ---------------------------------------------------------------------------

function useApiKey() {
  const [key, setKeyState] = useState(() => localStorage.getItem('akb:anthropic-key') ?? '');
  const save  = (k: string) => { localStorage.setItem('akb:anthropic-key', k); setKeyState(k); };
  const clear = () => { localStorage.removeItem('akb:anthropic-key'); setKeyState(''); };
  return { key, save, clear };
}

// ---------------------------------------------------------------------------
// Suggestion chips — static fallbacks + LLM-generated variants
// ---------------------------------------------------------------------------

function buildStaticSuggestions(
  selected: Set<NodeId>,
  focused: NodeId | null,
  nodesById: Map<NodeId, Node>,
): string[] {
  const chips: string[] = [];
  if (selected.size > 0) {
    chips.push(`Summarize the selected nodes`);
    chips.push(`What themes connect these selections?`);
    if (selected.size > 1) chips.push(`Compare these ${selected.size} items`);
  }
  if (focused) {
    const n = nodesById.get(focused);
    if (n?.child_ids.length) chips.push(`Explore the children of "${deriveLabel(n, 25)}"`);
    else chips.push(`Find nodes similar to "${deriveLabel(n ?? ({ id: focused } as Node), 25)}"`);
  }
  if (chips.length === 0) {
    chips.push(`What's in this knowledge base?`);
    chips.push(`Help me find interesting patterns`);
    chips.push(`Suggest what to explore first`);
  }
  return chips.slice(0, 4);
}

async function generateSuggestions(
  apiKey: string,
  systemPrompt: string,
): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: 'Generate exactly 4 short, specific exploration questions (each under 10 words) a user might ask about this knowledge base given the current context. Output ONLY a JSON array of strings, no explanation.',
      }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return (JSON.parse(match[0]) as string[]).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Main frame component
// ---------------------------------------------------------------------------

export function LLMFrame(_props: FrameProps) {
  const { key: apiKey, save: saveKey, clear: clearKey } = useApiKey();

  if (!apiKey) return <ApiKeySetup onSave={saveKey} />;
  return <ChatView apiKey={apiKey} onClearKey={clearKey} />;
}

// ---------------------------------------------------------------------------
// API key setup screen
// ---------------------------------------------------------------------------

function ApiKeySetup({ onSave }: { onSave: (k: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 32, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>Anthropic API key</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
        Enter your key to enable the LLM assistant. It is stored only in your browser's localStorage and never sent to any server other than Anthropic.
      </div>
      <input
        type="password"
        placeholder="sk-ant-..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && draft.startsWith('sk-') && onSave(draft.trim())}
        style={{ width: '100%', maxWidth: 320, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 13, outline: 'none' }}
        autoFocus
      />
      <button
        className="btn-primary"
        disabled={!draft.startsWith('sk-')}
        onClick={() => onSave(draft.trim())}
      >
        Save key
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------

function ChatView({ apiKey, onClearKey }: { apiKey: string; onClearKey: () => void }) {
  const nodesById = useStore(dataStore,     (s) => s.nodes);
  const byType    = useStore(dataStore,     (s) => s.byType);
  const byParent  = useStore(dataStore,     (s) => s.byParent);
  const manifest  = useStore(dataStore,     (s) => s.manifest);
  const selected  = useStore(selectionStore,(s) => s.selected);
  const focused   = useStore(selectionStore,(s) => s.focused);
  const visited   = useStore(historyStore,  (s) => s.visited);
  const level     = useStore(viewStore,     (s) => s.level);

  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [apiHistory, setApiHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const systemPrompt = useMemo(() => buildSystemPrompt(
    manifest?.label ?? '',
    byType, nodesById, byParent, selected, focused, visited, level,
  ), [manifest, byType, nodesById, byParent, selected, focused, visited, level]);

  const staticSuggestions = useMemo(
    () => buildStaticSuggestions(selected, focused, nodesById),
    [selected, focused, nodesById],
  );

  // Auto-generate suggestions (debounced) when selection/focus changes
  useEffect(() => {
    setSuggestions(staticSuggestions);
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const generated = await generateSuggestions(apiKey, systemPrompt);
        if (generated.length > 0) setSuggestions(generated);
      } catch { /* keep static */ }
      finally { setSuggestionsLoading(false); }
    }, 800);
    return () => { if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focused]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const msgId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput('');
    setError(null);

    const userDisplayMsg: DisplayMsg = { id: msgId(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userDisplayMsg]);

    const newApiHistory: ApiMessage[] = [...apiHistory, { role: 'user', content: trimmed }];
    setLoading(true);

    const assistantId = msgId();
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', text: '', isStreaming: true }]);

    try {
      let loopHistory = newApiHistory;
      let accText = '';
      const allToolCalls: { name: string; summary: string }[] = [];

      // Agentic loop: keep going until no more tool calls
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const blocks = await callClaude(apiKey, loopHistory, systemPrompt, (delta) => {
          accText += delta;
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, text: accText, isStreaming: true } : m,
          ));
        });

        loopHistory.push({ role: 'assistant', content: blocks });

        const toolUses = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) break;

        // Execute tools and collect results
        const toolResults: ContentBlock[] = toolUses.map((tu) => {
          const result = executeTool(tu.name, tu.input, nodesById);
          allToolCalls.push({ name: tu.name, summary: result });
          return { type: 'tool_result' as const, tool_use_id: tu.id, content: result };
        });

        loopHistory.push({ role: 'user', content: toolResults });
      }

      setApiHistory(loopHistory);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId
          ? { ...m, text: accText || '(no response)', isStreaming: false, toolCalls: allToolCalls.length ? allToolCalls : undefined }
          : m,
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="llm-frame">
      {/* Header */}
      <div className="llm-header">
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>claude · context-aware</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-ghost" style={{ fontSize: 10 }} onClick={() => { setMessages([]); setApiHistory([]); setError(null); }} title="Clear chat">clear</button>
          <button className="btn-ghost" style={{ fontSize: 10 }} onClick={onClearKey} title="Remove API key">key ✕</button>
        </div>
      </div>

      {/* Message list */}
      <div className="llm-messages">
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 48, lineHeight: 1.6 }}>
            Ask about the knowledge base.<br />
            I can see your selection, focused node, and all visualization context.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`llm-msg llm-msg-${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="llm-msg-role">claude</div>
            )}
            <div className="llm-msg-text">
              {msg.text || (msg.isStreaming ? <span className="llm-cursor" /> : null)}
            </div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="llm-tool-calls">
                {msg.toolCalls.map((tc, i) => (
                  <div key={i} className="llm-tool-badge">
                    <span className="llm-tool-name">{tc.name.replace(/_/g, ' ')}</span>
                    <span className="llm-tool-result">{tc.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="llm-error">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips — always visible, collapsible */}
      <div className="llm-suggestions-bar">
        <button
          className="llm-suggestions-toggle"
          onClick={() => setSuggestionsOpen((o) => !o)}
          title={suggestionsOpen ? 'Hide suggestions' : 'Show suggestions'}
        >
          {suggestionsLoading ? '⟳' : '✦'} suggestions {suggestionsOpen ? '▴' : '▾'}
        </button>
        {suggestionsOpen && (
          <div className="llm-suggestions">
            {suggestions.map((s) => (
              <button key={s} className="llm-chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="llm-input-row">
        <textarea
          ref={textareaRef}
          className="llm-textarea"
          placeholder="Ask about the selection or knowledge base…"
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          disabled={loading}
        />
        <button
          className="btn-primary"
          style={{ alignSelf: 'flex-end', fontSize: 12, padding: '5px 12px' }}
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}
