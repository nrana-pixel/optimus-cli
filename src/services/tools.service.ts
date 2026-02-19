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
 *   write_file     — Write / create a file  ← PRIMARY write tool
 *   list_dir       — List a directory's children
 *   search_files   — Grep-like search across the project
 *   find_symbol    — Find where a class / function is defined
 *   run_command    — Run a safe read-only terminal command
 */

import {
  existsSync, readFileSync, readdirSync, statSync,
  writeFileSync, mkdirSync,
} from 'fs';
import { join, resolve, relative, extname, dirname, normalize } from 'path';
import { execSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'list_dir'
  | 'search_files'
  | 'find_symbol'
  | 'run_command';

/** Metadata for files that were written this session */
export interface WrittenFile {
  path:     string;   // relative path from workingDir
  absPath:  string;
  lines:    number;
  isNew:    boolean;  // true = created, false = modified
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

  async execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      let output = '';
      switch (call.name) {
        case 'read_file':
          output = this.readFile(call.args.path ?? '');
          break;
        case 'write_file':
          output = this.writeFile(call.args.path ?? '', call.args.content ?? '');
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

    const isNew = !existsSync(abs);
    const dir   = dirname(abs);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(abs, content, 'utf-8');

    const lines = content.split('\n').length;
    this.written.push({ path: filePath, absPath: abs, lines, isNew });

    return `${isNew ? 'Created' : 'Updated'}: ${filePath} (${lines} lines)`;
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
    // Reuse search with a common definition pattern
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
   * The system-prompt section that teaches the LLM how to call tools.
   * This is injected as the system message in every chat turn.
   */
  static toolsSystemSection(): string {
    return `
You are Optimus — an expert AI coding agent. You have tools to read AND write files directly.

## CRITICAL BEHAVIOUR

When the user asks you to CREATE, MODIFY, or FIX code:
1. Use list_dir / read_file to understand the project structure first
2. Use write_file to write EVERY file — do NOT just show code in your reply
3. After writing all files, give a SHORT plain-English summary of what you did

Do NOT output raw code blocks in your reply when write_file can do the job.
Do NOT ask for permission to write files — just do it.

## Tool call format (use EXACTLY):

<use_tool><name>TOOL_NAME</name><args>{"arg": "value"}</args></use_tool>

## Available tools:

| Tool | Args | Description |
|------|------|---------|
| list_dir | path: string | Show directory tree |
| read_file | path: string | Read a file |
| write_file | path: string, content: string | Create or overwrite a file |
| search_files | pattern: string, glob?: string | Grep across project |
| find_symbol | symbol: string | Locate a class/function definition |
| run_command | command: string | Run a safe read-only terminal command |

## Example workflow for "create an Express server":

<use_tool><name>list_dir</name><args>{"path": "."}</args></use_tool>

... (receives directory listing) ...

<use_tool><name>write_file</name><args>{"path": "server.ts", "content": "import express...\n"}</args></use_tool>
<use_tool><name>write_file</name><args>{"path": "controllers/hello.ts", "content": "..."}</args></use_tool>
<use_tool><name>write_file</name><args>{"path": "middleware/logger.ts", "content": "..."}</args></use_tool>

Done! Created 3 files: server.ts, controllers/hello.ts, middleware/logger.ts
`.trim();
  }
}
