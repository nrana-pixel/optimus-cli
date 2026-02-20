/**
 * IndexService — Phase 3: Persistent Symbol Index + Repo Map
 *
 * Two main capabilities:
 *
 * 1. SYMBOL INDEX (SQLite-backed, hash-cached)
 *    Parses TypeScript/JavaScript/Python/Go files and stores symbols in a local DB.
 *    Only re-indexes files that have changed (hash comparison → fast startup).
 *
 * 2. REPO MAP (Aider-style)
 *    Generates a compact, human-readable index of every symbol in the project.
 *    ~2-5KB max. Injected into the system prompt so the LLM always knows the full
 *    codebase structure without needing a `list_dir` / `read_file` first.
 *
 * 3. SEMANTIC SEARCH (Embedding-based)
 *    Chunks files into ~512-token blocks, embeds them using the configured LLM
 *    provider's embedding endpoint, and stores vectors in SQLite.
 *    At query time: embeds the question, does cosine similarity search, returns
 *    top-K most relevant code chunks.
 *
 * Storage: ~/.multi-agent/index/<project-hash>/
 *   - symbols.db   (SQLite: files, symbols, imports, embeddings)
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import {
  existsSync, readFileSync, statSync, readdirSync, mkdirSync, writeFileSync,
} from 'fs';
import { join, relative, extname, dirname } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndexedFile {
  path:     string;  // relative to project root
  hash:     string;
  mtime:    number;
  language: string;
  lines:    number;
  size:     number;
}

export interface IndexedSymbol {
  id?:       number;
  name:      string;
  kind:      'class' | 'function' | 'const' | 'interface' | 'type' | 'enum' | 'method' | 'export';
  signature: string;
  file:      string;
  line:      number;
}

export interface SearchResult {
  file:    string;
  lines:   string;
  chunk:   string;
  score:   number;
}

// ─── Language parsers ────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.c': 'c',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  'coverage', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj',
]);

const MAX_FILE_SIZE_BYTES = 300_000;  // 300 KB
const MAX_FILES_TO_INDEX  = 2_000;

// ─── Symbol extractors (regex-based, cross-platform) ────────────────────────

function extractSymbols(content: string, filePath: string, lang: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const lines = content.split('\n');

  const addSymbol = (
    name: string, kind: IndexedSymbol['kind'],
    sig: string, lineNum: number,
  ) => symbols.push({ name, kind, signature: sig.slice(0, 200), file: filePath, line: lineNum });

  if (lang === 'typescript' || lang === 'javascript') {
    lines.forEach((line, i) => {
      const l = line.trim();
      const ln = i + 1;

      // class Foo / class Foo extends Bar
      let m = l.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (m) { addSymbol(m[1], 'class', l, ln); return; }

      // interface IFoo
      m = l.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (m) { addSymbol(m[1], 'interface', l, ln); return; }

      // type FooType = ...
      m = l.match(/^(?:export\s+)?type\s+(\w+)\s*=/);
      if (m) { addSymbol(m[1], 'type', l, ln); return; }

      // enum Direction
      m = l.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/);
      if (m) { addSymbol(m[1], 'enum', l, ln); return; }

      // function foo(...)
      m = l.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[\(<]/);
      if (m) { addSymbol(m[1], 'function', l, ln); return; }

      // const/let/var foo = (...) => or = function(
      m = l.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/);
      if (m) { addSymbol(m[1], 'function', l, ln); return; }

      // const/let/var foo =
      m = l.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/);
      if (m) { addSymbol(m[1], 'const', l, ln); return; }

      // method inside class: async foo( or foo(
      m = l.match(/^(?:public|private|protected|static|async|\s)*(?:async\s+)?(\w+)\s*\(/);
      if (m && !['if','for','while','switch','catch','constructor'].includes(m[1])) {
        addSymbol(m[1], 'method', l, ln);
      }
    });
  } else if (lang === 'python') {
    lines.forEach((line, i) => {
      const l = line.trim();
      const ln = i + 1;
      let m = l.match(/^class\s+(\w+)/);
      if (m) { addSymbol(m[1], 'class', l, ln); return; }
      m = l.match(/^(?:async\s+)?def\s+(\w+)/);
      if (m) { addSymbol(m[1], 'function', l, ln); return; }
    });
  } else if (lang === 'go') {
    lines.forEach((line, i) => {
      const l = line.trim();
      const ln = i + 1;
      let m = l.match(/^type\s+(\w+)\s+struct/);
      if (m) { addSymbol(m[1], 'class', l, ln); return; }
      m = l.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
      if (m) { addSymbol(m[1], 'function', l, ln); return; }
    });
  }

  return symbols;
}

// ─── IndexService ─────────────────────────────────────────────────────────────

export class IndexService {
  private db!: Database.Database;
  private projectRoot: string;
  private dbPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const projectHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 8);
    const indexDir = join(homedir(), '.multi-agent', 'index', projectHash);
    if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
    this.dbPath = join(indexDir, 'symbols.db');
    this._openDb();
  }

  private _openDb() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path      TEXT PRIMARY KEY,
        hash      TEXT,
        mtime     INTEGER,
        language  TEXT,
        lines     INTEGER,
        size      INTEGER
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT,
        kind      TEXT,
        signature TEXT,
        file      TEXT REFERENCES files(path) ON DELETE CASCADE,
        line      INTEGER
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        file       TEXT,
        start_line INTEGER,
        end_line   INTEGER,
        chunk_text TEXT,
        vector     TEXT   -- JSON float array
      );

      CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_sym_file ON symbols(file);
      CREATE INDEX IF NOT EXISTS idx_emb_file ON embeddings(file);
    `);
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  /** Walk the project and re-index changed files. Returns stats. */
  async buildIndex(onProgress?: (msg: string) => void): Promise<{ files: number; symbols: number; skipped: number }> {
    const allFiles = this._collectFiles(this.projectRoot);
    let indexed = 0, skipped = 0, totalSymbols = 0;

    const insertFile = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, hash, mtime, language, lines, size)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const deleteSymbols = this.db.prepare(`DELETE FROM symbols WHERE file = ?`);
    const insertSymbol  = this.db.prepare(`
      INSERT INTO symbols (name, kind, signature, file, line)
      VALUES (?, ?, ?, ?, ?)
    `);

    const doIndexBatch = this.db.transaction((files: string[]) => {
      for (const abs of files) {
        const rel = relative(this.projectRoot, abs);
        const ext = extname(abs).toLowerCase();
        const lang = LANG_MAP[ext] || 'text';

        const st = statSync(abs);
        if (st.size > MAX_FILE_SIZE_BYTES) { skipped++; continue; }

        const content = readFileSync(abs, 'utf-8');
        const hash = createHash('sha1').update(content).digest('hex');

        // Check if already indexed with same hash
        const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(rel) as any;
        if (existing?.hash === hash) { skipped++; continue; }

        // Index this file
        const lines = content.split('\n').length;
        insertFile.run(rel, hash, st.mtimeMs, lang, lines, st.size);

        deleteSymbols.run(rel);
        const symbols = extractSymbols(content, rel, lang);
        for (const s of symbols) {
          insertSymbol.run(s.name, s.kind, s.signature, s.file, s.line);
        }
        totalSymbols += symbols.length;
        indexed++;
      }
    });

    doIndexBatch(allFiles);

    onProgress?.(`Indexed ${indexed} files, ${totalSymbols} symbols (${skipped} unchanged)`);
    return { files: indexed, symbols: totalSymbols, skipped };
  }

  // ─── Repo Map (Aider-style) ───────────────────────────────────────────────

  /**
   * Generate a compact repo map:
   * Returns a ~2-5KB text block listing all files and their symbols.
   * Injected into the system prompt so the LLM always knows the codebase.
   */
  generateRepoMap(maxTokensApprox = 3000): string {
    const files = this.db.prepare(`
      SELECT f.path, f.language, f.lines, GROUP_CONCAT(s.kind || ':' || s.name, '|') as syms
      FROM files f
      LEFT JOIN symbols s ON s.file = f.path
      GROUP BY f.path
      ORDER BY f.path
    `).all() as Array<{ path: string; language: string; lines: number; syms: string | null }>;

    if (files.length === 0) return '';

    const lines: string[] = ['## Repo Map\n'];
    let charCount = 20;
    const CHAR_BUDGET = maxTokensApprox * 4; // rough 4 chars/token

    for (const file of files) {
      if (charCount > CHAR_BUDGET) {
        lines.push(`... (${files.length - lines.length} more files)`);
        break;
      }

      const header = `${file.path}:`;
      lines.push(header);
      charCount += header.length + 1;

      if (file.syms) {
        const symbols = file.syms.split('|').slice(0, 20); // max 20 symbols per file
        for (const s of symbols) {
          const [kind, name] = s.split(':');
          const row = `  ${kind.padEnd(10)} ${name}`;
          lines.push(row);
          charCount += row.length + 1;
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  // ─── Symbol Lookup ─────────────────────────────────────────────────────────

  /** Lookup a symbol by exact name */
  lookupSymbol(name: string): IndexedSymbol[] {
    return this.db.prepare(`
      SELECT * FROM symbols WHERE name = ? OR name LIKE ?
      LIMIT 20
    `).all(name, `%${name}%`) as IndexedSymbol[];
  }

  /** Search symbols by partial name */
  searchSymbols(query: string): IndexedSymbol[] {
    return this.db.prepare(`
      SELECT * FROM symbols
      WHERE name LIKE ? OR signature LIKE ?
      LIMIT 30
    `).all(`%${query}%`, `%${query}%`) as IndexedSymbol[];
  }

  /** Get all symbols in a file */
  getFileSymbols(filePath: string): IndexedSymbol[] {
    return this.db.prepare(`
      SELECT * FROM symbols WHERE file = ? ORDER BY line
    `).all(filePath) as IndexedSymbol[];
  }

  // ─── Semantic Search (Embedding-based) ────────────────────────────────────

  /** Chunk text into overlapping blocks (~512 tokens each) */
  private _chunkFile(content: string, filePath: string): Array<{ file: string; start: number; end: number; text: string }> {
    const CHUNK_LINES = 40;   // ~512 tokens
    const OVERLAP     = 5;    // line overlap
    const lineArr = content.split('\n');
    const chunks = [];
    for (let start = 0; start < lineArr.length; start += CHUNK_LINES - OVERLAP) {
      const end = Math.min(start + CHUNK_LINES, lineArr.length);
      const text = lineArr.slice(start, end).join('\n');
      if (text.trim()) chunks.push({ file: filePath, start: start + 1, end, text });
      if (end >= lineArr.length) break;
    }
    return chunks;
  }

  /**
   * Build embeddings for the whole project using the provided embedding function.
   * The embedFn receives a text string and returns a float[] vector.
   */
  async buildEmbeddings(
    embedFn: (text: string) => Promise<number[]>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const files = this.db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
    const insertEmb = this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (file, start_line, end_line, chunk_text, vector)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.db.prepare('DELETE FROM embeddings').run();

    let done = 0;
    for (const { path: rel } of files) {
      const abs = join(this.projectRoot, rel);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, 'utf-8');
      const chunks = this._chunkFile(content, rel);

      for (const chunk of chunks) {
        const vec = await embedFn(`FILE: ${chunk.file}\nLINES: ${chunk.start}-${chunk.end}\n${chunk.text}`);
        insertEmb.run(chunk.file, chunk.start, chunk.end, chunk.text, JSON.stringify(vec));
        done++;
        onProgress?.(done, -1);
      }
    }

    return done;
  }

  /**
   * Semantic search: embed query, find top-K similar chunks using cosine similarity.
   */
  async semanticSearch(
    query: string,
    embedFn: (text: string) => Promise<number[]>,
    topK = 5,
  ): Promise<SearchResult[]> {
    const queryVec = await embedFn(query);
    const rows = this.db.prepare(`
      SELECT file, start_line, end_line, chunk_text, vector FROM embeddings
    `).all() as Array<{ file: string; start_line: number; end_line: number; chunk_text: string; vector: string }>;

    const scored = rows.map(row => {
      const vec: number[] = JSON.parse(row.vector);
      const score = this._cosine(queryVec, vec);
      return {
        file:  row.file,
        lines: `${row.start_line}-${row.end_line}`,
        chunk: row.chunk_text,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private _cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  getStats(): { files: number; symbols: number; embeddings: number } {
    const files      = (this.db.prepare('SELECT COUNT(*) AS c FROM files').get() as any).c;
    const symbols    = (this.db.prepare('SELECT COUNT(*) AS c FROM symbols').get() as any).c;
    const embeddings = (this.db.prepare('SELECT COUNT(*) AS c FROM embeddings').get() as any).c;
    return { files, symbols, embeddings };
  }

  // ─── File collector ────────────────────────────────────────────────────────

  private _collectFiles(dir: string): string[] {
    const result: string[] = [];
    const walk = (current: string, depth = 0) => {
      if (depth > 10) return;
      let entries: string[];
      try { entries = readdirSync(current); } catch { return; }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const abs = join(current, entry);
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (st.isDirectory()) { walk(abs, depth + 1); }
        else if (st.isFile() && LANG_MAP[extname(entry).toLowerCase()]) {
          result.push(abs);
          if (result.length >= MAX_FILES_TO_INDEX) return;
        }
      }
    };
    walk(dir);
    return result;
  }

  close() {
    this.db.close();
  }
}

// ─── Embedding provider helpers ───────────────────────────────────────────────

/** OpenAI-compatible embedding (works with OpenAI, OpenRouter, and local models with /v1/embeddings) */
export async function openaiEmbed(text: string, apiKey: string, model = 'text-embedding-3-small', baseUrl = 'https://api.openai.com/v1'): Promise<number[]> {
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.statusText}`);
  const data = await res.json() as any;
  return data.data[0].embedding;
}

/** Google Gemini embedding */
export async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'models/text-embedding-004', content: { parts: [{ text }] } }),
  });
  if (!res.ok) throw new Error(`Gemini embedding error: ${res.statusText}`);
  const data = await res.json() as any;
  return data.embedding.values;
}
