/**
 * IndexService — Phase 3: Persistent Symbol Index + Repo Map
 *
 * Pure-JavaScript implementation using JSON file storage.
 * No native dependencies — works on any platform without compilation.
 *
 * Storage: ~/.multi-agent/index/<project-hash>/
 *   - files.json      (indexed files with hashes)
 *   - symbols.json    (extracted symbols)
 *   - embeddings.json (semantic search vectors, created on demand)
 */

import { createHash } from 'crypto';
import {
  existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync,
} from 'fs';
import { join, relative, extname } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndexedFile {
  path:     string;
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

export interface EmbeddingRecord {
  id:         number;
  file:       string;
  start_line: number;
  end_line:   number;
  chunk_text: string;
  vector:     number[];
}

export interface SearchResult {
  file:    string;
  lines:   string;
  chunk:   string;
  score:   number;
}

// ─── Language map ─────────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java',
  '.cs': 'csharp',
  '.cpp': 'cpp', '.cc': 'cpp',
  '.c': 'c',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  'coverage', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj',
]);

const MAX_FILE_SIZE_BYTES = 300_000;
const MAX_FILES_TO_INDEX  = 2_000;

// ─── Symbol extractor (regex, cross-platform) ────────────────────────────────

function extractSymbols(content: string, filePath: string, lang: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const lines = content.split('\n');

  const add = (name: string, kind: IndexedSymbol['kind'], sig: string, ln: number) =>
    symbols.push({ name, kind, signature: sig.slice(0, 200), file: filePath, line: ln });

  if (lang === 'typescript' || lang === 'javascript') {
    lines.forEach((line, i) => {
      const l = line.trim(); const ln = i + 1;
      let m: RegExpMatchArray | null;

      if ((m = l.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/))) { add(m[1], 'class', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?interface\s+(\w+)/))) { add(m[1], 'interface', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?type\s+(\w+)\s*=/))) { add(m[1], 'type', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/))) { add(m[1], 'enum', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[\(<]/))) { add(m[1], 'function', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/))) { add(m[1], 'function', l, ln); return; }
      if ((m = l.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/))) { add(m[1], 'const', l, ln); return; }
      if ((m = l.match(/^(?:public|private|protected|static|async|\s)*(?:async\s+)?(\w+)\s*\(/))) {
        if (!['if','for','while','switch','catch','constructor'].includes(m[1])) add(m[1], 'method', l, ln);
      }
    });
  } else if (lang === 'python') {
    lines.forEach((line, i) => {
      const l = line.trim(); const ln = i + 1;
      let m: RegExpMatchArray | null;
      if ((m = l.match(/^class\s+(\w+)/))) { add(m[1], 'class', l, ln); return; }
      if ((m = l.match(/^(?:async\s+)?def\s+(\w+)/))) { add(m[1], 'function', l, ln); }
    });
  } else if (lang === 'go') {
    lines.forEach((line, i) => {
      const l = line.trim(); const ln = i + 1;
      let m: RegExpMatchArray | null;
      if ((m = l.match(/^type\s+(\w+)\s+struct/))) { add(m[1], 'class', l, ln); return; }
      if ((m = l.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/))) { add(m[1], 'function', l, ln); }
    });
  }

  return symbols;
}

// ─── JsonDb: lightweight JSON-file store ────────────────────────────────────

class JsonDb {
  private filesData:      Record<string, IndexedFile>  = {};
  private symbolsData:    IndexedSymbol[]               = [];
  private embeddingsData: EmbeddingRecord[]             = [];
  private nextSymId  = 1;
  private nextEmbId  = 1;

  constructor(
    private readonly filesPath:      string,
    private readonly symbolsPath:    string,
    private readonly embeddingsPath: string,
  ) {
    this._load();
  }

  private _load() {
    try {
      if (existsSync(this.filesPath))
        this.filesData = JSON.parse(readFileSync(this.filesPath, 'utf-8'));
      if (existsSync(this.symbolsPath)) {
        this.symbolsData = JSON.parse(readFileSync(this.symbolsPath, 'utf-8'));
        this.nextSymId = (this.symbolsData[this.symbolsData.length - 1]?.id ?? 0) + 1;
      }
      if (existsSync(this.embeddingsPath)) {
        this.embeddingsData = JSON.parse(readFileSync(this.embeddingsPath, 'utf-8'));
        this.nextEmbId = (this.embeddingsData[this.embeddingsData.length - 1]?.id ?? 0) + 1;
      }
    } catch { /* fresh DB */ }
  }

  saveFiles()      { writeFileSync(this.filesPath,      JSON.stringify(this.filesData,      null, 0), 'utf-8'); }
  saveSymbols()    { writeFileSync(this.symbolsPath,    JSON.stringify(this.symbolsData,    null, 0), 'utf-8'); }
  saveEmbeddings() { writeFileSync(this.embeddingsPath, JSON.stringify(this.embeddingsData, null, 0), 'utf-8'); }

  getFile(path: string): IndexedFile | undefined { return this.filesData[path]; }
  upsertFile(f: IndexedFile) { this.filesData[f.path] = f; }

  deleteSymbolsForFile(file: string) {
    this.symbolsData = this.symbolsData.filter(s => s.file !== file);
  }

  insertSymbol(s: Omit<IndexedSymbol, 'id'>) {
    this.symbolsData.push({ ...s, id: this.nextSymId++ });
  }

  searchSymbols(query: string): IndexedSymbol[] {
    const q = query.toLowerCase();
    return this.symbolsData.filter(s =>
      s.name.toLowerCase().includes(q) || s.signature.toLowerCase().includes(q)
    ).slice(0, 30);
  }

  lookupSymbol(name: string): IndexedSymbol[] {
    const exact = this.symbolsData.filter(s => s.name === name);
    if (exact.length > 0) return exact;
    const q = name.toLowerCase();
    return this.symbolsData.filter(s => s.name.toLowerCase().includes(q)).slice(0, 20);
  }

  getSymbolsForFile(file: string): IndexedSymbol[] {
    return this.symbolsData.filter(s => s.file === file).sort((a, b) => a.line - b.line);
  }

  allFiles(): IndexedFile[] { return Object.values(this.filesData); }
  allSymbols(): IndexedSymbol[] { return this.symbolsData; }

  fileCounts() { return Object.keys(this.filesData).length; }
  symbolCounts() { return this.symbolsData.length; }
  embeddingCounts() { return this.embeddingsData.length; }

  clearEmbeddings() { this.embeddingsData = []; this.nextEmbId = 1; }
  insertEmbedding(e: Omit<EmbeddingRecord, 'id'>) {
    this.embeddingsData.push({ ...e, id: this.nextEmbId++ });
  }
  allEmbeddings(): EmbeddingRecord[] { return this.embeddingsData; }
}

// ─── IndexService ─────────────────────────────────────────────────────────────

export class IndexService {
  private db: JsonDb;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const projectHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 8);
    const indexDir = join(homedir(), '.multi-agent', 'index', projectHash);
    if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });

    this.db = new JsonDb(
      join(indexDir, 'files.json'),
      join(indexDir, 'symbols.json'),
      join(indexDir, 'embeddings.json'),
    );
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  async buildIndex(onProgress?: (msg: string) => void): Promise<{ files: number; symbols: number; skipped: number }> {
    const allFiles = this._collectFiles(this.projectRoot);
    let indexed = 0, skipped = 0, totalNewSymbols = 0;

    for (const abs of allFiles) {
      const rel  = relative(this.projectRoot, abs);
      const ext  = extname(abs).toLowerCase();
      const lang = LANG_MAP[ext] || 'text';

      let st;
      try { st = statSync(abs); } catch { skipped++; continue; }
      if (st.size > MAX_FILE_SIZE_BYTES) { skipped++; continue; }

      let content: string;
      try { content = readFileSync(abs, 'utf-8'); } catch { skipped++; continue; }

      const hash = createHash('sha1').update(content).digest('hex');

      const existing = this.db.getFile(rel);
      if (existing?.hash === hash) { skipped++; continue; }

      // Re-index this file
      this.db.upsertFile({ path: rel, hash, mtime: st.mtimeMs, language: lang, lines: content.split('\n').length, size: st.size });
      this.db.deleteSymbolsForFile(rel);

      const symbols = extractSymbols(content, rel, lang);
      for (const s of symbols) this.db.insertSymbol(s);
      totalNewSymbols += symbols.length;
      indexed++;
    }

    // Persist after full walk
    this.db.saveFiles();
    this.db.saveSymbols();

    onProgress?.(`Indexed ${indexed} files, ${totalNewSymbols} new symbols (${skipped} unchanged)`);
    return { files: indexed, symbols: totalNewSymbols, skipped };
  }

  // ─── Repo Map ─────────────────────────────────────────────────────────────

  generateRepoMap(maxTokensApprox = 3000): string {
    const allFiles  = this.db.allFiles();
    const allSyms   = this.db.allSymbols();
    if (allFiles.length === 0) return '';

    // Group symbols by file
    const byFile = new Map<string, IndexedSymbol[]>();
    for (const s of allSyms) {
      if (!byFile.has(s.file)) byFile.set(s.file, []);
      byFile.get(s.file)!.push(s);
    }

    const lines: string[] = ['## Repo Map\n'];
    let charCount = 20;
    const CHAR_BUDGET = maxTokensApprox * 4;

    const sorted = [...allFiles].sort((a, b) => a.path.localeCompare(b.path));

    for (const file of sorted) {
      if (charCount > CHAR_BUDGET) {
        lines.push(`... (${sorted.length - lines.length} more files)`);
        break;
      }
      lines.push(`${file.path}:`);
      charCount += file.path.length + 2;

      const syms = (byFile.get(file.path) ?? []).slice(0, 20);
      for (const s of syms) {
        const row = `  ${s.kind.padEnd(10)} ${s.name}`;
        lines.push(row);
        charCount += row.length + 1;
      }
    }

    return lines.join('\n') + '\n';
  }

  // ─── Symbol lookup ─────────────────────────────────────────────────────────

  lookupSymbol(name: string): IndexedSymbol[]   { return this.db.lookupSymbol(name); }
  searchSymbols(query: string): IndexedSymbol[] { return this.db.searchSymbols(query); }
  getFileSymbols(filePath: string): IndexedSymbol[] { return this.db.getSymbolsForFile(filePath); }

  // ─── Semantic Search ───────────────────────────────────────────────────────

  private _chunkFile(content: string, filePath: string) {
    const CHUNK_LINES = 40, OVERLAP = 5;
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

  async buildEmbeddings(
    embedFn: (text: string) => Promise<number[]>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    this.db.clearEmbeddings();
    const files = this.db.allFiles();
    let done = 0;

    for (const { path: rel } of files) {
      const abs = join(this.projectRoot, rel);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, 'utf-8');
      const chunks  = this._chunkFile(content, rel);
      for (const chunk of chunks) {
        const vec = await embedFn(`FILE: ${chunk.file}\nLINES: ${chunk.start}-${chunk.end}\n${chunk.text}`);
        this.db.insertEmbedding({ file: chunk.file, start_line: chunk.start, end_line: chunk.end, chunk_text: chunk.text, vector: vec });
        done++;
        onProgress?.(done, -1);
      }
    }

    this.db.saveEmbeddings();
    return done;
  }

  async semanticSearch(
    query: string,
    embedFn: (text: string) => Promise<number[]>,
    topK = 5,
  ): Promise<SearchResult[]> {
    const queryVec = await embedFn(query);
    const rows = this.db.allEmbeddings();

    const scored = rows.map(row => ({
      file:  row.file,
      lines: `${row.start_line}-${row.end_line}`,
      chunk: row.chunk_text,
      score: this._cosine(queryVec, row.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private _cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats() {
    return {
      files:      this.db.fileCounts(),
      symbols:    this.db.symbolCounts(),
      embeddings: this.db.embeddingCounts(),
    };
  }

  // ─── File walker ──────────────────────────────────────────────────────────

  private _collectFiles(dir: string): string[] {
    const result: string[] = [];
    const walk = (current: string, depth = 0) => {
      if (depth > 10 || result.length >= MAX_FILES_TO_INDEX) return;
      let entries: string[];
      try { entries = readdirSync(current); } catch { return; }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const abs = join(current, entry);
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (st.isDirectory()) walk(abs, depth + 1);
        else if (st.isFile() && LANG_MAP[extname(entry).toLowerCase()]) result.push(abs);
      }
    };
    walk(dir);
    return result;
  }

  close() { /* no-op — JSON writes are synchronous */ }
}

// ─── Embedding helpers ────────────────────────────────────────────────────────

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
