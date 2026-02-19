                                      # Agent Codebase Context — Ideal Implementation Roadmap

> Reference doc for upgrading the file analyzer toward how Claude Code / Cursor / Aider actually work.
> Current status: Phase 1 ✅ done. Phases 2–4 to be built.

---

## Current State (Phase 1) ✅

Static one-shot analysis:

```
node bin/dev.js analyze . --save
      │
      ▼
regex-based file walker
      │
      ▼
dump markdown → paste into LLM
```

**Limitations:**
- Regex breaks on multiline / aliased exports
- Sends everything (no relevance filtering)
- LLM is passive — receives a dump, can't navigate
- No caching — re-reads all files every run
- No semantic understanding

---

## Phase 2 — Tool Use in Chat (ReAct Loop)

> **Highest impact. Build this next.**

Give the LLM tools it can call mid-conversation to navigate the codebase itself.

### Tools to implement

```typescript
// src/services/tools.service.ts

const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    params: { path: "string" }
  },
  {
    name: "list_directory",
    description: "List files and folders in a directory",
    params: { path: "string" }
  },
  {
    name: "search_files",
    description: "Search for a pattern across all project files (grep-like)",
    params: { pattern: "string", fileGlob: "string (optional)" }
  },
  {
    name: "find_symbol",
    description: "Find where a function, class, or variable is defined",
    params: { symbol: "string" }
  },
  {
    name: "run_command",
    description: "Run a terminal command and return stdout",
    params: { command: "string" }
  },
  {
    name: "write_file",
    description: "Write or overwrite a file with new content",
    params: { path: "string", content: "string" }
  }
]
```

### ReAct Loop

```
User sends message
      │
      ▼
LLM receives message + tool definitions
      │
      ▼
LLM responds with tool_call (e.g. read_file("src/auth/middleware.ts"))
      │
      ▼
CLI executes the tool, captures output
      │
      ▼
Output appended to conversation as tool_result
      │
      ▼
LLM reasons again → maybe calls another tool
      │
      ▼
... loop until LLM produces final text answer
      │
      ▼
Show answer to user
```

### API format (OpenAI/Gemini tool calling)

```json
// Message to LLM
{
  "role": "user",
  "content": "how does authentication work?"
}

// LLM responds with tool call
{
  "role": "assistant",
  "tool_calls": [{
    "id": "call_1",
    "function": {
      "name": "search_files",
      "arguments": "{ \"pattern\": \"auth\" }"
    }
  }]
}

// CLI appends tool result
{
  "role": "tool",
  "tool_call_id": "call_1",
  "content": "src/middleware/auth.ts:12: const auth = ..."
}
```

### Key files to create

```
src/
├── services/
│   └── tools.service.ts      ← tool executor (read_file, search, etc.)
└── commands/
    └── chat.ts               ← update to pass tools to LLM + handle tool_calls
```

---

## Phase 3 — Persistent Symbol Index (SQLite)

> Eliminates re-scanning on every run. Instant startup.

### Architecture

```
File change detected (chokidar watcher)
      │
      ▼
Check hash vs stored hash in SQLite
      │
  unchanged → skip
  changed   → re-index file
      │
      ▼
Parse with Tree-sitter (real AST, not regex)
      │
      ▼
Store in SQLite:
  - files table    (path, hash, mtime, language, lines)
  - symbols table  (name, kind, file, line, signature)
  - imports table  (from_file, to_module)
```

### Why Tree-sitter over regex

| | Regex | Tree-sitter |
|---|---|---|
| Multiline exports | ❌ breaks | ✅ correct |
| Aliased imports | ❌ misses | ✅ correct |
| Type-only imports | ❌ misses | ✅ correct |
| Function signatures | ❌ partial | ✅ full with params |
| Nested structures | ❌ fails | ✅ AST-aware |
| Speed | fast | fast (C bindings) |

### SQLite schema

```sql
CREATE TABLE files (
  path      TEXT PRIMARY KEY,
  hash      TEXT,
  mtime     INTEGER,
  language  TEXT,
  lines     INTEGER,
  size      INTEGER
);

CREATE TABLE symbols (
  id        INTEGER PRIMARY KEY,
  name      TEXT,
  kind      TEXT,  -- class, function, const, interface, type
  signature TEXT,
  file      TEXT REFERENCES files(path),
  line      INTEGER
);

CREATE TABLE imports (
  from_file TEXT,
  to_module TEXT,
  is_local  BOOLEAN
);
```

### Packages needed

```bash
pnpm add better-sqlite3 chokidar tree-sitter tree-sitter-typescript
pnpm add -D @types/better-sqlite3
```

---

## Phase 4 — Semantic Search with Embeddings

> Lets the LLM find conceptually related code, not just keyword matches.

### How it works

```
At index time:
  file chunk (512 tokens)  →  embedding API  →  vector [0.12, -0.87, ...]
  stored in SQLite as BLOB or separate vector DB

At query time:
  user question  →  embedding API  →  query vector
                                            │
                                            ▼
                                   cosine similarity
                                   vs all chunk vectors
                                            │
                                            ▼
                                   top-K most similar chunks
                                   sent to LLM as context
```

### Chunking strategy

```
File → split into chunks of ~512 tokens with 64-token overlap
Each chunk tagged with: file path, start line, end line, language
```

### Embedding providers

| Provider | Model | Cost | Dims |
|---|---|---|---|
| OpenAI | text-embedding-3-small | $0.02/1M tokens | 1536 |
| Google | text-embedding-004 | free tier available | 768 |
| Ollama | nomic-embed-text | free (local) | 768 |

### Packages needed

```bash
pnpm add @xenova/transformers  # local embeddings, no API needed
# OR use existing OPENROUTER_API_KEY / GOOGLE_API_KEY
```

---

## Aider's Repo Map Approach (Simpler Alternative to Embeddings)

Aider generates a compact **repo map** using `ctags` — a text file listing every symbol and its location. This fits in ~2K tokens and is sent with every message.

```
src/commands/chat.ts:
  Spinner (class)
    start()
    stop()
  Prompt (class)
    show()
    _key(k: string)
    _draw()
  Chat (class) [export default]
    run()
    _ask(line: string)
    _slash(line: string)
    _banner(resumed: boolean)

src/services/llm-litellm.service.ts:
  LLMServiceLiteLLM (class) [export]
    complete(message, systemPrompt?, callbacks?)
    completeWithHistory(messages, callbacks?)
    completeGeminiNative(messages, callbacks?)
```

**Advantages over embeddings:**
- No API calls
- Deterministic
- Tiny (fits in system prompt)
- The LLM then asks to read specific files it needs

**Implementation:** parse Tree-sitter output → format as indented text → prepend to every system prompt

---

## Implementation Priority

```
┌─────────────────────────────────────────────────────┐
│  Priority  │  Feature              │  Effort         │
├─────────────────────────────────────────────────────┤
│  🔴 High   │  Tool use (Phase 2)  │  ~4 hours       │
│  🟡 Medium │  Repo map (Aider)    │  ~2 hours       │
│  🟡 Medium │  SQLite index        │  ~6 hours       │
│  🟢 Low    │  Embeddings          │  ~8 hours       │
└─────────────────────────────────────────────────────┘
```

Start with **tool use** — it gives the LLM agency to navigate the codebase on its own.
That single change transforms this from a context-dump tool into a real coding agent.

---

## References

- [Claude Code system prompt (leaked)](https://simonwillison.net/2025/Jan/25/claude-code-system-prompt/)
- [Aider repo map explanation](https://aider.chat/docs/repomap.html)
- [Cursor codebase indexing](https://cursor.com/blog/codebase-indexing)
- [Tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground)
- [ReAct paper](https://arxiv.org/abs/2210.03629)
