// Memory auto-layer (PMB-style): setup once, memory triggers itself.
//
// What it does without any model cooperation:
//   session.created  -> prefetch relevant memories (cached for injection)
//   tui.prompt.append (best-effort) -> inject cached memories into the prompt
//   tool.execute.after -> ambient journal of edits/tests/commits (LOCAL, keyless)
//   session.idle     -> auto-retain journal digest (needs Hindsight + LLM key)
//   compacting       -> preserve memories + journal digest across compaction
//
// Everything is defensive: any failure is silent, the session never breaks.
// Full prompt-injection comes from @vectorize-io/opencode-hindsight (see
// opencode.jsonc); this plugin adds the local-first ambient layer.
import fs from 'node:fs';
import path from 'node:path';

const NOISY_TOOLS = new Set(['read', 'glob', 'grep', 'list', 'lsp']);
const JOURNAL_FILE = '.memory-journal.jsonl';
const PREFETCH_FILE = '.opencode/memory-prefetch.json';

function readJsonc(file) {
  try {
    const text = fs.readFileSync(file, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Single source of truth: the project's own opencode.jsonc MCP entry.
function resolveConfig(directory) {
  const cfg = readJsonc(path.join(directory, 'opencode.jsonc')) || {};
  const entry = (cfg.mcp && cfg.mcp.hindsight) || {};
  const url = process.env.HINDSIGHT_API_URL || entry.url || 'http://localhost:8888/mcp/d-memory/';
  const m = url.match(/\/mcp\/([^/]+)\/?$/);
  return {
    apiBase: process.env.HINDSIGHT_API_URL
      ? process.env.HINDSIGHT_API_URL.replace(/\/mcp.*$/, '')
      : url.replace(/\/mcp.*$/, ''),
    bankId: process.env.HINDSIGHT_BANK_ID || (m && m[1]) || 'd-memory'
  };
}

async function api(apiBase, method, p, body, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${apiBase}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function recallProject(apiBase, bankId, query) {
  const res = await api(apiBase, 'POST', `/v1/default/banks/${bankId}/memories/recall`, {
    query,
    budget: 'low',
    max_tokens: 1200
  });
  const items = (res && res.results) || [];
  return items.slice(0, 5).map((r) => `- ${r.text}`).join('\n');
}

function journalAppend(directory, entry) {
  try {
    fs.appendFileSync(
      path.join(directory, JOURNAL_FILE),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    );
  } catch { /* journal is best-effort */ }
}

function journalDigest(directory, max = 30) {
  try {
    const file = path.join(directory, JOURNAL_FILE);
    if (!fs.existsSync(file)) return '';
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').slice(-max);
    return lines.map((l) => {
      try {
        const e = JSON.parse(l);
        return `${e.ts} ${e.tool} ${e.summary || ''}`.trim();
      } catch { return ''; }
    }).filter(Boolean).join('\n');
  } catch { return ''; }
}

function toolSummary(tool, args) {
  try {
    const a = args || {};
    return String(a.filePath || a.file || a.command || a.pattern || a.query || '').slice(0, 160);
  } catch { return ''; }
}

export const MemoryAutoLayer = async ({ directory }) => {
  const { apiBase, bankId } = resolveConfig(directory);

  return {
    // Session start: prefetch project overview into a cache file.
    event: async ({ event }) => {
      try {
        if (event.type === 'session.created') {
          const ctx = await recallProject(apiBase, bankId, 'project overview decisions architecture');
          if (ctx) {
            fs.mkdirSync(path.join(directory, '.opencode'), { recursive: true });
            fs.writeFileSync(path.join(directory, PREFETCH_FILE), JSON.stringify({ ts: Date.now(), ctx }));
          }
        }
        if (event.type === 'session.idle') {
          // Auto-retain: journal digest -> SESSION_SUMMARY (server extracts from it).
          const digest = journalDigest(directory);
          if (digest) {
            await api(apiBase, 'POST', `/v1/default/banks/${bankId}/memories`, {
              items: [{
                content: `Session activity digest:\n${digest}`,
                tags: ['type:SESSION_SUMMARY', 'importance:LOW', 'scope:SESSION', `project:${bankId}`, 'source:autowrite']
              }]
            });
          }
        }
      } catch { /* never break the session */ }
    },

    // Ambient observe: journal every meaningful tool call. Local + keyless.
    'tool.execute.after': async (input, output) => {
      try {
        const tool = input.tool || (output && output.tool);
        if (!tool || NOISY_TOOLS.has(tool)) return;
        journalAppend(directory, { tool, summary: toolSummary(tool, (output && output.args) || input.args) });
      } catch { /* never break the session */ }
    },

    // Best-effort prompt injection of prefetched memories (ignored if unsupported).
    'tui.prompt.append': async (input, output) => {
      try {
        const f = path.join(directory, PREFETCH_FILE);
        if (!fs.existsSync(f)) return;
        const { ctx } = JSON.parse(fs.readFileSync(f, 'utf-8'));
        if (ctx && output && typeof output.text === 'string' && !output.text.includes('Relevant project memories')) {
          output.text = `${output.text}\n\nRelevant project memories:\n${ctx}`;
        }
      } catch { /* unsupported host: no-op */ }
    },

    // Compaction: keep memories + recent activity across context trimming.
    'experimental.session.compacting': async (input, output) => {
      try {
        const digest = journalDigest(directory, 15);
        const lines = ['## Memory checkpoint (auto)'];
        if (digest) lines.push(`Recent activity:\n${digest}`);
        try {
          const f = path.join(directory, PREFETCH_FILE);
          if (fs.existsSync(f)) {
            const { ctx } = JSON.parse(fs.readFileSync(f, 'utf-8'));
            if (ctx) lines.push(`Project memories:\n${ctx}`);
          }
        } catch { /* no prefetch */ }
        if (output && Array.isArray(output.context)) output.context.push(lines.join('\n'));
      } catch { /* never break compaction */ }
    }
  };
};
