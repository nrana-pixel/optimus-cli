/**
 * Tools Service — Phase 2 of AGENT_CONTEXT_ROADMAP.md
 *
 * Implements the tool-use layer so the LLM can navigate and MODIFY
 * the codebase itself instead of receiving a blind context dump.
 *
 * Text-based tool call format (works across all LLM providers):
 *   <use_tool><name>read_file</name><args>{"path":"src/..."}</args></use_tool>
 *
 * Tools available:
 *   read_file      — Read a file's content
 *   write_file     — Write / create a file
 *   edit_file      — Surgical search-and-replace editing
 *   list_dir       — List a directory's children
 *   search_files   — Grep-like search across the project
 *   find_symbol    — Find where a class / function is defined
 *   run_command    — Run a safe read-only terminal command
 *   git_status     — Show git working tree status
 *   git_diff       — Show git diff of changes
 *   git_log        — Show recent git commits
 */

import {
  existsSync, readFileSync, readdirSync, statSync,
  writeFileSync, mkdirSync, copyFileSync, unlinkSync,
} from 'fs';
import { join, resolve, relative, extname, dirname } from 'path';
import { execSync } from 'child_process';
import { truncateMiddle } from '../utils/truncate.js';
import { createTwoFilesPatch } from 'diff';
import { UnifiedExecService } from './unified-exec.service.js';
import type { IndexService } from './index.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'apply_patch'
  | 'list_dir'
  | 'search_files'
  | 'find_symbol'
  | 'lookup_symbol'
  | 'semantic_search'
  | 'run_command'
  | 'run_tests'
  | 'write_stdin'
  | 'git_status'
  | 'git_diff'
  | 'git_log';

/** Metadata for files that were written this session */
export interface WrittenFile {
  path:     string;   // relative path from workingDir
  absPath:  string;
  lines:    number;
  isNew:    boolean;  // true = created, false = modified
}

/** Snapshot of a file before modification (for /undo) */
export interface FileSnapshot {
  absPath:  string;
  relPath:  string;
  existed:  boolean;
  content:  string | null;   // null if file didn't exist
}

export interface ToolCall {
  name: ToolName;
  args: Record<string, string>;
}

export interface ToolResult {
  name:       ToolName;
  args:       Record<string, string>;
  output:     string;
  error?:     string;
  durationMs: number;
}

// ─── Safety ──────────────────────────────────────────────────────────────────

const BLOCKED_CMD_PATTERNS = [
  /\brm\b/, /\bdel\b/, /\berase\b/, /\bformat\b/, /\bmkfs\b/,
  /\bsudo\b/, /\bsu\b/, /\bcurl\b.*\|/, /\bwget\b.*\|/,
  />\s*\//, />\s*[A-Za-z]:\\/, /\bchmod\s+[0-7]*7/,
  /\bkill\b/, /\bpkill\b/, /\bshutdown\b/, /\breboot\b/,
  /\bnpm\s+publish\b/, /\bpnpm\s+publish\b/, /\byarn\s+publish\b/,
  /\bgit\s+push\b/, /\bgit\s+reset.*--hard\b/,
  /\bRemove-Item\b/i, /\bStop-Process\b/i, /\bRestart-Computer\b/i,
  /\bInvoke-WebRequest\b.*\|/i, /\bInvoke-RestMethod\b.*\|/i,
];

function isSafeCommand(cmd: string): boolean {
  return !BLOCKED_CMD_PATTERNS.some(p => p.test(cmd));
}

// ─── ToolsService ─────────────────────────────────────────────────────────

export class ToolsService {
  private readonly MAX_FILE_BYTES = 200_000;   // 200 KB cap per file read
  private readonly MAX_RESULTS    = 30;         // search result cap
  private readonly MAX_CMD_OUTPUT = 8_000;      // chars

  public unifiedExec = new UnifiedExecService();

  constructor(private workingDir: string) {}

  // ─── Execute dispatcher ─────────────────────────────────────────────────

  /** Tracks all files written this session for the Changes panel */
  public written: WrittenFile[] = [];

  /** Tracks file snapshots for /undo */
  public snapshots: FileSnapshot[] = [];

  /** Whether this is plan-only mode (no writes) */
  public planMode: boolean = false;

  /**
   * Optional IndexService injection — when provided, find_symbol, lookup_symbol,
   * and semantic_search use the SQLite index for faster, smarter results.
   */
  public indexService: IndexService | null = null;

  /** Embed function for semantic_search tool — injected by Chat */
  public embedFn: ((text: string) => Promise<number[]>) | null = null;

  async execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      let output = '';

      // In plan mode, block destructive tools
      if (this.planMode && ['write_file', 'edit_file', 'run_command', 'run_tests'].includes(call.name)) {
        return {
          name: call.name, args: call.args,
          output: '', error: `🔒 Plan mode active — ${call.name} is blocked. Use /plan to toggle off.`,
          durationMs: Date.now() - start,
        };
      }

      switch (call.name) {
        case 'read_file':
          output = this.readFile(call.args.path ?? '');
          break;
        case 'write_file':
          output = this.writeFile(call.args.path ?? '', call.args.content ?? '');
          break;
        case 'edit_file':
          output = this.editFile(call.args.path ?? '', call.args.old_content ?? '', call.args.new_content ?? '');
          break;
        case 'apply_patch':
          output = this.applyPatch(call.args.path ?? '', call.args.patch ?? '');
          break;
        case 'list_dir':
          output = this.listDir(call.args.path ?? '.');
          break;
        case 'search_files':
          output = this.searchFiles(call.args.pattern ?? '', call.args.glob ?? '');
          break;
        case 'find_symbol':
          // Use fast SQLite index if available, otherwise fall back to grep
          if (this.indexService) {
            const syms = this.indexService.searchSymbols(call.args.symbol ?? '');
            if (syms.length > 0) {
              output = syms.map(s => `${s.file}:${s.line}:  ${s.kind}  ${s.name}  ${s.signature}`).join('\n');
              break;
            }
          }
          output = this.findSymbol(call.args.symbol ?? '');
          break;
        case 'lookup_symbol':
          if (this.indexService) {
            const syms = this.indexService.lookupSymbol(call.args.name ?? '');
            output = syms.length > 0
              ? syms.map(s => `${s.file}:${s.line}: [${s.kind}] ${s.name} — ${s.signature}`).join('\n')
              : `Symbol "${call.args.name}" not found in index. Try /index to rebuild.`;
          } else {
            output = this.findSymbol(call.args.name ?? '');
          }
          break;
        case 'semantic_search':
          if (this.indexService && this.embedFn) {
            try {
              const results = await this.indexService.semanticSearch(
                call.args.query ?? '', this.embedFn,
                parseInt(call.args.top_k ?? '5')
              );
              if (results.length === 0) {
                output = 'No semantic matches found. The index may not have embeddings yet.';
              } else {
                output = results.map(r =>
                  `## ${r.file} (lines ${r.lines}, score: ${r.score.toFixed(3)})\n${r.chunk}`
                ).join('\n\n---\n\n');
              }
            } catch (err: any) {
              output = `Semantic search failed: ${err.message}`;
            }
          } else {
            output = 'Semantic search not available. Use search_files for keyword-based search instead.';
          }
          break;
        case 'run_command':
        case 'run_tests':
          output = await this.runCommand(call.args.command ?? '');
          break;
        case 'write_stdin':
          output = await this.unifiedExec.writeStdin(call.args.id ?? '', call.args.text ?? '');
          break;
        case 'git_status':
          output = this.gitStatus();
          break;
        case 'git_diff':
          output = this.gitDiff(call.args.ref ?? '');
          break;
        case 'git_log':
          output = this.gitLog(call.args.count ?? '10');
          break;
        default:
          output = `Unknown tool: ${call.name}`;
      }
      return { name: call.name, args: call.args, output, durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        name: call.name, args: call.args,
        output: '', error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── Tool implementations ────────────────────────────────────────────────

  private readFile(filePath: string): string {
    const abs = resolve(this.workingDir, filePath);
    if (!existsSync(abs)) return `File not found: ${filePath}`;

    const st = statSync(abs);
    if (st.isDirectory()) return `${filePath} is a directory — use list_dir instead`;

    const content = readFileSync(abs, 'utf-8');
    if (st.size > this.MAX_FILE_BYTES || content.split('\n').length > 1000) {
      return truncateMiddle(content, {
        maxChars: this.MAX_FILE_BYTES,
        maxLines: 1000,
        preserveHeadLines: 100,
        preserveTailLines: 100
      });
    }

    return content;
  }

  private writeFile(filePath: string, content: string): string {
    if (!filePath) return 'write_file requires a path argument';
    if (content === undefined || content === null) return 'write_file requires a content argument';

    // Safety: prevent path traversal outside workingDir
    const abs = resolve(this.workingDir, filePath);
    const rel = relative(this.workingDir, abs);
    if (rel.startsWith('..')) {
      return `Blocked: path "${filePath}" would escape the working directory`;
    }

    // ── Snapshot for /undo ──
    this._snapshot(abs, rel);

    const isNew = !existsSync(abs);
    const dir   = dirname(abs);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(abs, content, 'utf-8');

    const lines = content.split('\n').length;
    this.written.push({ path: filePath, absPath: abs, lines, isNew });

    return `${isNew ? 'Created' : 'Updated'}: ${filePath} (${lines} lines)`;
  }

  /**
   * Surgical edit — replaces `old_content` with `new_content` inside a file.
   * Much safer than write_file for existing files — only changes what's needed.
   */
  private editFile(filePath: string, oldContent: string, newContent: string): string {
    if (!filePath) return 'edit_file requires a path argument';
    if (!oldContent) return 'edit_file requires an old_content argument (the text to find and replace)';

    const abs = resolve(this.workingDir, filePath);
    const rel = relative(this.workingDir, abs);
    if (rel.startsWith('..')) return `Blocked: path traversal outside working directory`;
    if (!existsSync(abs)) return `File not found: ${filePath}`;

    const original = readFileSync(abs, 'utf-8');

    // Count occurrences
    const count = original.split(oldContent).length - 1;
    if (count === 0) {
      return `edit_file failed: old_content not found in ${filePath}. Make sure your old_content EXACTLY matches the file content (including whitespace).`;
    }

    // ── Snapshot for /undo ──
    this._snapshot(abs, rel);

    // Replace all occurrences (predictable behavior for users)
    const updated = original.split(oldContent).join(newContent);
    writeFileSync(abs, updated, 'utf-8');

    const lines = updated.split('\n').length;
    this.written.push({ path: filePath, absPath: abs, lines, isNew: false });

    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    const msg = `Edited: ${filePath} — replaced ${count} occurrence(s) (${oldLines} line(s) → ${newLines} line(s))`;
    return msg;
  }

  async preview(call: ToolCall): Promise<{ path: string; diffText: string; insertions: number; deletions: number } | null> {
    const { name, args } = call;
    const path = args.path;
    if (!path || !['write_file', 'edit_file', 'apply_patch'].includes(name)) return null;

    const abs = resolve(this.workingDir, path);
    const rel = relative(this.workingDir, abs);
    
    let oldContent = '';
    let newContent = '';
    
    try {
      if (existsSync(abs)) {
        oldContent = readFileSync(abs, 'utf-8');
      }

      if (name === 'write_file') {
        newContent = args.content ?? '';
      } else if (name === 'edit_file') {
        const toFind = args.old_content ?? '';
        const toReplace = args.new_content ?? '';
        if (!oldContent.includes(toFind)) return null;
        newContent = oldContent.split(toFind).join(toReplace);
      } else if (name === 'apply_patch') {
        const patch = args.patch ?? '';
        const result = this._calculatePatch(oldContent, patch);
        if (typeof result === 'string') return null; // error message
        newContent = result.content;
      }

      const diffText = createTwoFilesPatch(path, path, oldContent, newContent, '', '', { context: 3 });
      const lines = diffText.split('\n');
      const insertions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

      return { path, diffText, insertions, deletions };
    } catch {
      return null;
    }
  }

  private _calculatePatch(original: string, patch: string): { content: string; count: number } | string {
    const blocks = patch.split('<<<<<< SEARCH');
    if (blocks.length <= 1) return 'No blocks';

    let currentContent = original;
    let appliedCount = 0;

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const parts = block.split('======');
      if (parts.length !== 2) continue;

      const searchPart = parts[0].trim();
      const replacePartWithEnd = parts[1];
      const replaceParts = replacePartWithEnd.split('>>>>>>');
      if (replaceParts.length < 2) continue;

      const replacePart = replaceParts[0].trim();

      if (currentContent.includes(searchPart)) {
        currentContent = currentContent.replace(searchPart, replacePart);
        appliedCount++;
      } else {
        return `Could not find SEARCH block`;
      }
    }
    return { content: currentContent, count: appliedCount };
  }

  private applyPatch(filePath: string, patch: string): string {
    if (!filePath) return 'apply_patch requires a path argument';
    if (!patch) return 'apply_patch requires a patch argument';

    const abs = resolve(this.workingDir, filePath);
    if (!existsSync(abs)) return `File not found: ${filePath}`;

    const original = readFileSync(abs, 'utf-8');
    const rel = relative(this.workingDir, abs);

    const result = this._calculatePatch(original, patch);
    if (typeof result === 'string') return `apply_patch failed: ${result}`;

    if (result.count > 0) {
      this._snapshot(abs, rel);
      writeFileSync(abs, result.content, 'utf-8');
      this.written.push({ path: filePath, absPath: abs, lines: result.content.split('\n').length, isNew: false });
      return `Applied ${result.count} patch block(s) to ${filePath}`;
    }

    return 'apply_patch failed: No blocks were successfully applied.';
  }

  private listDir(dirPath: string): string {
    const abs = resolve(this.workingDir, dirPath);
    if (!existsSync(abs)) return `Directory not found: ${dirPath}`;
    if (!statSync(abs).isDirectory()) return `${dirPath} is a file — use read_file instead`;

    const IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage']);

    const lines: string[] = [`${dirPath}/`];

    const walk = (dir: string, prefix: string, depth: number) => {
      if (depth > 4) return;
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !IGNORE.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      entries.forEach((entry, i) => {
        const last      = i === entries.length - 1;
        const connector = last ? '└── ' : '├── ';
        const childPfx  = last ? '    ' : '│   ';
        const label     = entry.isDirectory() ? `📁 ${entry.name}/` : entry.name;
        lines.push(`${prefix}${connector}${label}`);
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), prefix + childPfx, depth + 1);
        }
      });
    };

    walk(abs, '', 0);
    return lines.join('\n');
  }

  private searchFiles(pattern: string, glob: string): string {
    if (!pattern) return 'search_files requires a pattern argument';

    const results: string[] = [];
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'gi');
    } catch (e: any) {
      return `Invalid search pattern (regex): ${e?.message ?? String(e)}`;
    }
    const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
    const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.md', '.json', '.yaml', '.yml', '.css', '.html', '.sql', '.sh']);

    const search = (dir: string) => {
      if (results.length >= this.MAX_RESULTS) return;
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }

      for (const entry of entries) {
        if (results.length >= this.MAX_RESULTS) break;
        const abs = join(dir, entry);
        let st;
        try { st = statSync(abs); } catch { continue; }

        if (st.isDirectory()) {
          if (!IGNORE.has(entry)) search(abs);
          continue;
        }

        const ext = extname(entry).toLowerCase();
        // Glob filtering: match against relative path, not just filename
        if (glob) {
          const rel = relative(this.workingDir, abs).replace(/\\/g, '/');
          const globLower = glob.toLowerCase();
          // Simple glob match: support *.ext and **/*.ext patterns
          if (globLower.includes('*')) {
            const parts = globLower.split('*').filter(Boolean);
            const matchTarget = globLower.includes('/') ? rel.toLowerCase() : entry.toLowerCase();
            const matches = parts.every(part => matchTarget.includes(part));
            if (!matches) continue;
          } else {
            // No wildcards: check if filename or path contains the glob
            const rel2 = rel.toLowerCase();
            if (!rel2.includes(globLower) && !entry.toLowerCase().includes(globLower)) continue;
          }
        }
        if (!EXT.has(ext)) continue;

        try {
          const content = readFileSync(abs, 'utf-8');
          const lines   = content.split('\n');
          lines.forEach((line, i) => {
            if (results.length < this.MAX_RESULTS && re.test(line)) {
              const rel = relative(this.workingDir, abs).replace(/\\/g, '/');
              results.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
            }
            re.lastIndex = 0;
          });
        } catch { /* skip unreadable */ }
      }
    };

    search(this.workingDir);
    if (!results.length) return `No matches for "${pattern}"`;
    return results.join('\n') +
      (results.length === this.MAX_RESULTS ? `\n\n[Results capped at ${this.MAX_RESULTS}]` : '');
  }

  private findSymbol(symbol: string): string {
    if (!symbol) return 'find_symbol requires a symbol argument';
    const patterns = [
      `class\\s+${symbol}\\b`,
      `function\\s+${symbol}\\b`,
      `const\\s+${symbol}\\s*=`,
      `let\\s+${symbol}\\s*=`,
      `export\\s+.*${symbol}\\b`,
      `interface\\s+${symbol}\\b`,
      `type\\s+${symbol}\\s*=`,
    ];

    const results: string[] = [];
    for (const pat of patterns) {
      const found = this.searchFiles(pat, '');
      if (found && !found.startsWith('No matches')) {
        results.push(found);
      }
    }
    return results.length
      ? results.join('\n')
      : `Symbol "${symbol}" not found in project`;
  }

  private async runCommand(cmd: string): Promise<string> {
    if (!cmd) return 'run_command requires a command argument';

    const trimmed = cmd.trim();

    if (!isSafeCommand(trimmed)) {
      return `Blocked: "${cmd}" matches a potentially destructive pattern.`;
    }

    try {
      // Use UnifiedExec for all commands to allow future stdin interaction
      return await this.unifiedExec.spawn(trimmed, [], this.workingDir);
    } catch (e: any) {
      const err = e.stderr || e.message;
      return truncateMiddle(`Command failed: ${err}`, {
        maxChars: this.MAX_CMD_OUTPUT,
        maxLines: 200,
        preserveHeadLines: 40,
        preserveTailLines: 40
      });
    }
  }

  // ─── Git tools ──────────────────────────────────────────────────────────

  private gitStatus(): string {
    try {
      return execSync('git status --short', {
        cwd: this.workingDir, encoding: 'utf-8', timeout: 5000,
      }) || '(clean working tree)';
    } catch (e: any) {
      return `git status failed: ${e.message}`;
    }
  }

  private gitDiff(ref: string): string {
    try {
      const cmd = ref ? `git diff ${ref}` : 'git diff';
      const output = execSync(cmd, {
        cwd: this.workingDir, encoding: 'utf-8', timeout: 10000,
      });
      return (output || '(no changes)').slice(0, this.MAX_CMD_OUTPUT);
    } catch (e: any) {
      return `git diff failed: ${e.message}`;
    }
  }

  private gitLog(count: string): string {
    try {
      const n = Math.min(parseInt(count) || 10, 30);
      return execSync(`git log --oneline -n ${n}`, {
        cwd: this.workingDir, encoding: 'utf-8', timeout: 5000,
      }) || '(no commits)';
    } catch (e: any) {
      return `git log failed: ${e.message}`;
    }
  }

  // ─── Snapshot / Undo ──────────────────────────────────────────────────────

  /** Save a snapshot of a file before modifying it */
  private _snapshot(abs: string, rel: string) {
    // Only snapshot once per file per session
    if (this.snapshots.some(s => s.absPath === abs)) return;
    const existed = existsSync(abs);
    this.snapshots.push({
      absPath: abs,
      relPath: rel,
      existed,
      content: existed ? readFileSync(abs, 'utf-8') : null,
    });
  }

  /** Restore all files to their pre-edit state */
  undoAll(): string[] {
    const restored: string[] = [];
    for (const snap of this.snapshots) {
      if (snap.existed && snap.content !== null) {
        writeFileSync(snap.absPath, snap.content, 'utf-8');
        restored.push(`↩ Restored: ${snap.relPath}`);
      } else if (!snap.existed && existsSync(snap.absPath)) {
        // File was newly created — delete it
        try {
          unlinkSync(snap.absPath);
          restored.push(`🗑 Deleted (was new): ${snap.relPath}`);
        } catch { /* skip */ }
      }
    }
    this.snapshots = [];
    this.written   = [];
    return restored;
  }

  // ─── Static helpers ───────────────────────────────────────────────────────

  /**
   * Parse <use_tool>...</use_tool> blocks from any LLM response.
   * Works with all providers since it's plain text, not native function calling.
   */
  static parseToolCalls(response: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const TOOL_RE = /<use_tool>\s*<name>([\w_]+)<\/name>\s*<args>([\s\S]*?)<\/args>\s*<\/use_tool>/g;
    let m: RegExpExecArray | null;

    while ((m = TOOL_RE.exec(response)) !== null) {
      const name = m[1] as ToolName;
      let args: Record<string, string> = {};
      try { args = JSON.parse(m[2].trim()); } catch { /* bad JSON, skip */ }
      calls.push({ name, args });
    }

    return calls;
  }

  /**
   * Format result blocks to inject back into the conversation.
   */
  static formatToolResult(result: ToolResult): string {
    const body = result.error
      ? `ERROR: ${result.error}`
      : result.output;
    return `<tool_result>\n<name>${result.name}</name>\n<output>\n${body}\n</output>\n</tool_result>`;
  }

  /**
   * Read OPTIMUS.md project context if it exists.
   * Checks for: OPTIMUS.md, optimus.md, .optimus.md
   */
  static readProjectContext(workingDir: string): string | null {
    const candidates = ['OPTIMUS.md', 'optimus.md', '.optimus.md'];
    for (const name of candidates) {
      const p = join(workingDir, name);
      if (existsSync(p)) {
        try {
          const content = readFileSync(p, 'utf-8');
          return content.slice(0, 4000); // cap at 4K to save context
        } catch { /* skip */ }
      }
    }
    return null;
  }

  /**
   * Hierarchical local context reading.
   * Searches for .optimus.md or AGENTS.md from current directory up to root.
   */
  static readLocalInstructions(startDir: string, rootDir: string): string {
    const candidates = ['.optimus.md', 'AGENTS.md', 'agents.md'];
    let current = resolve(startDir);
    const root = resolve(rootDir);
    const foundFiles: string[] = [];
    const instructions: string[] = [];

    // Traverse upwards from current dir to root
    while (true) {
      for (const name of candidates) {
        const p = join(current, name);
        if (existsSync(p) && !foundFiles.includes(p)) {
          try {
            const content = readFileSync(p, 'utf-8');
            instructions.push(`### Instructions from ${relative(root, p)}:\n${content}`);
            foundFiles.push(p);
          } catch { /* skip */ }
        }
      }

      if (current === root || current === dirname(current)) break;
      current = dirname(current);
    }

    return instructions.reverse().join('\n\n'); // Root-level first
  }

  /**
   * Return native OpenAI-compatible tool definitions.
   */
  static getNativeTools(planMode = false): any[] {
    const tools: any[] = [
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'Show directory tree',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the directory to list' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the file to read' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_files',
          description: 'Grep across project',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Regex pattern to search for' },
              glob: { type: 'string', description: 'Optional glob pattern to filter files' }
            },
            required: ['pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'find_symbol',
          description: 'Locate a class/function definition (regex-based)',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'Symbol name to find' }
            },
            required: ['symbol']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'lookup_symbol',
          description: 'Fast exact symbol lookup using the SQLite index (preferred when available)',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Symbol name to look up' }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'semantic_search',
          description: "Find conceptually related code by meaning — e.g. 'authentication logic' finds auth code even if the word 'auth' isn't in the file",
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Semantic query string' },
              top_k: { type: 'string', description: 'Number of results to return (default: 5)' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_status',
          description: 'Show git working tree status',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_diff',
          description: 'Show git diff (optionally from a ref)',
          parameters: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Optional git ref' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'git_log',
          description: 'Show recent git commits',
          parameters: {
            type: 'object',
            properties: {
              count: { type: 'string', description: 'Number of commits to show' }
            }
          }
        }
      }
    ];

    if (!planMode) {
      tools.push(
        {
          type: 'function',
          function: {
            name: 'write_file',
            description: 'Create or overwrite a file (use for NEW files)',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to write' },
                content: { type: 'string', description: 'File content' }
              },
              required: ['path', 'content']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'edit_file',
            description: 'Replace specific content in a file (preferred for edits). old_content must EXACTLY match part of the file (including whitespace/indentation).',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to edit' },
                old_content: { type: 'string', description: 'The exact text to find and replace' },
                new_content: { type: 'string', description: 'The text to replace it with' }
              },
              required: ['path', 'old_content', 'new_content']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'apply_patch',
            description: 'Resilient surgical edit using SEARCH/REPLACE blocks. Use this for reliable code modification.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Path to edit' },
                patch: { type: 'string', description: 'One or more blocks in the format: <<<<<< SEARCH\\n...\\n======\\n...\\n>>>>>>' }
              },
              required: ['path', 'patch']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'run_command',
            description: 'Run a terminal command (e.g. pnpm inst, mkdir, node script)',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Command to run' }
              },
              required: ['command']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'run_tests',
            description: 'Run tests/typecheck (e.g. npm test, tsc). Use this after editing code to catch and auto-fix errors quickly within this loop.',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string', description: 'Command to run tests' }
              },
              required: ['command']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'write_stdin',
            description: 'Provide input to a running process spawned by run_command or exec_command.',
            parameters: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'The Process ID (e.g. exec_12345)' },
                text: { type: 'string', description: 'The text to send to the process' }
              },
              required: ['id', 'text']
            }
          }
        }
      );
    }

    return tools;
  }

  /**
   * The system-prompt section that teaches the LLM about the project and editing rules.
   */
  static toolsSystemSection(projectContext?: string | null, planMode = false, localInstructions?: string): string {
    const planNote = planMode
      ? `\n\n## ⚠️ PLAN MODE ACTIVE\nYou are in READ-ONLY plan mode. You can use read_file, list_dir, search_files, find_symbol, git_status, git_diff, git_log.\nYou CANNOT use write_file, edit_file, or run_command.\nAnalyze the codebase and create a detailed implementation plan for the user's request.\n`
      : '';

    const contextBlock = projectContext
      ? `\n\n## Project Context (from OPTIMUS.md)\n${projectContext}\n`
      : '';

    const localBlock = localInstructions
      ? `\n\n## Local Directory Instructions (AGENTS.md)\n${localInstructions}\n`
      : '';

    return `
You are Optimus — an expert AI coding agent. You are precise, safe, and helpful.

## HOW YOU WORK

### 1. Personality & Tone
- Your tone is concise, direct, and collaborative.
- **Preamble messages**: Before making tool calls, send a brief message (1-2 sentences) explaining what you are about to do (e.g., "I've explored the repo; now checking the API route definitions.").
- Avoid excessively verbose explanations unless specifically asked.

### 2. Planning
- For non-trivial tasks, always start by exploring the directory structure.
- Before writing code, summarize your plan to the user.
- If you have an 'update_plan' tool, use it to track progress.

### 3. Task Execution
- Fix problems at the root cause.
- Keep changes consistent with the style of the existing codebase.
- **CRITICAL**: Use list_dir / read_file to understand project structure first.
- For EXISTING files, prefer **apply_patch** (resilient surgical replace) over write_file.
- Use write_file only for NEW files.
- Do NOT output raw code blocks in your reply when apply_patch can do the job.

${contextBlock}${localBlock}${planNote}

## apply_patch — how to use:
Use apply_patch to modify existing files reliably. Provide a SEARCH block that matches a unique section of the file exactly, and a REPLACE block with your changes.

Format:
<<<<<< SEARCH
[existing code to find]
======
[new code to replace it with]
>>>>>>

Example:
<use_tool><name>apply_patch</name><args>{"path": "src/app.ts", "patch": "<<<<<< SEARCH\\nconst port = 3000;\\n======\\nconst port = process.env.PORT || 3000;\\n>>>>>>"}</args></use_tool>
`.trim();
  }
}
