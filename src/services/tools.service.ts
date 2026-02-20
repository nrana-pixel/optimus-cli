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
  writeFileSync, mkdirSync, copyFileSync,
} from 'fs';
import { join, resolve, relative, extname, dirname } from 'path';
import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'list_dir'
  | 'search_files'
  | 'find_symbol'
  | 'run_command'
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
  /\brm\b/, /\bdel\b/, /\bformat\b/, /\bmkfs\b/,
  /\bsudo\b/, /\bsu\b/, /\bcurl\b.*\|/, /\bwget\b.*\|/,
  />\s*\//, />\s*[A-Za-z]:\\/, /\bchmod\s+[0-7]*7/,
  /\bkill\b/, /\bpkill\b/, /\bshutdown\b/, /\breboot\b/,
  /\bnpm\s+publish\b/, /\bgit\s+push\b/, /\bgit\s+reset.*--hard\b/,
];

function isSafeCommand(cmd: string): boolean {
  return !BLOCKED_CMD_PATTERNS.some(p => p.test(cmd));
}

// ─── ToolsService ─────────────────────────────────────────────────────────

export class ToolsService {
  private readonly MAX_FILE_BYTES = 200_000;   // 200 KB cap per file read
  private readonly MAX_RESULTS    = 30;         // search result cap
  private readonly MAX_CMD_OUTPUT = 8_000;      // chars

  constructor(private workingDir: string) {}

  // ─── Execute dispatcher ─────────────────────────────────────────────────

  /** Tracks all files written this session for the Changes panel */
  public written: WrittenFile[] = [];

  /** Tracks file snapshots for /undo */
  public snapshots: FileSnapshot[] = [];

  /** Whether this is plan-only mode (no writes) */
  public planMode: boolean = false;

  async execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      let output = '';

      // In plan mode, block destructive tools
      if (this.planMode && ['write_file', 'edit_file', 'run_command'].includes(call.name)) {
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
        case 'list_dir':
          output = this.listDir(call.args.path ?? '.');
          break;
        case 'search_files':
          output = this.searchFiles(call.args.pattern ?? '', call.args.glob ?? '');
          break;
        case 'find_symbol':
          output = this.findSymbol(call.args.symbol ?? '');
          break;
        case 'run_command':
          output = this.runCommand(call.args.command ?? '');
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
    if (st.size > this.MAX_FILE_BYTES) {
      return `File too large (${(st.size / 1024).toFixed(0)} KB). Showing first ${this.MAX_FILE_BYTES / 1024} KB:\n\n` +
        readFileSync(abs, 'utf-8').slice(0, this.MAX_FILE_BYTES);
    }

    return readFileSync(abs, 'utf-8');
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

    const updated = original.replace(oldContent, newContent);
    writeFileSync(abs, updated, 'utf-8');

    const lines = updated.split('\n').length;
    this.written.push({ path: filePath, absPath: abs, lines, isNew: false });

    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    return `Edited: ${filePath} — replaced ${oldLines} line(s) with ${newLines} line(s)${count > 1 ? ` (first of ${count} occurrences)` : ''}`;
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
    const re = new RegExp(pattern, 'gi');
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
        if (glob && !entry.includes(glob.replace('*', '')) && !glob.includes('*')) continue;
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

  private runCommand(cmd: string): string {
    if (!cmd) return 'run_command requires a command argument';
    if (!isSafeCommand(cmd)) {
      return `Blocked: "${cmd}" matches a potentially destructive pattern. Only safe read-only commands are allowed.`;
    }

    try {
      const output = execSync(cmd, {
        cwd:     this.workingDir,
        timeout: 10_000,
        encoding: 'utf-8',
        stdio:   ['pipe', 'pipe', 'pipe'],
      });
      return (output || '(no output)').slice(0, this.MAX_CMD_OUTPUT);
    } catch (e: any) {
      return `Command failed: ${e.stderr || e.message}`.slice(0, this.MAX_CMD_OUTPUT);
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
          const { unlinkSync } = require('fs');
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
   * The system-prompt section that teaches the LLM how to call tools.
   * This is injected as the system message in every chat turn.
   */
  static toolsSystemSection(projectContext?: string | null, planMode = false): string {
    const planNote = planMode
      ? `\n\n## ⚠️ PLAN MODE ACTIVE\nYou are in READ-ONLY plan mode. You can use read_file, list_dir, search_files, find_symbol, git_status, git_diff, git_log.\nYou CANNOT use write_file, edit_file, or run_command.\nAnalyze the codebase and create a detailed implementation plan for the user's request.\n`
      : '';

    const contextBlock = projectContext
      ? `\n\n## Project Context (from OPTIMUS.md)\n${projectContext}\n`
      : '';

    return `
You are Optimus — an expert AI coding agent. You have tools to read AND write files directly.
${contextBlock}${planNote}
## CRITICAL BEHAVIOUR

When the user asks you to CREATE, MODIFY, or FIX code:
1. Use list_dir / read_file to understand the project structure first
2. For EXISTING files, prefer edit_file (surgical replace) over write_file (full overwrite)
3. Use write_file only for NEW files
4. After writing/editing all files, give a SHORT plain-English summary of what you did

Do NOT output raw code blocks in your reply when edit_file/write_file can do the job.
Do NOT ask for permission to write files — just do it.

## Tool call format (use EXACTLY):

<use_tool><name>TOOL_NAME</name><args>{"arg": "value"}</args></use_tool>

## Available tools:

| Tool | Args | Description |
|------|------|---------
| list_dir | path: string | Show directory tree |
| read_file | path: string | Read a file |
| write_file | path: string, content: string | Create or overwrite a file (use for NEW files) |
| edit_file | path: string, old_content: string, new_content: string | Replace specific content in a file (preferred for edits) |
| search_files | pattern: string, glob?: string | Grep across project |
| find_symbol | symbol: string | Locate a class/function definition |
| run_command | command: string | Run a safe read-only terminal command |
| git_status | (none) | Show git working tree status |
| git_diff | ref?: string | Show git diff (optionally from a ref) |
| git_log | count?: string | Show recent git commits |

## edit_file — how to use:

edit_file replaces the FIRST occurrence of old_content with new_content.
old_content must EXACTLY match part of the file (including whitespace/indentation).

Example:
<use_tool><name>edit_file</name><args>{"path": "src/app.ts", "old_content": "const port = 3000;", "new_content": "const port = process.env.PORT || 3000;"}</args></use_tool>
`.trim();
  }
}
