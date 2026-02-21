
import { Command, Flags } from '@oclif/core';
import { LLMServiceLiteLLM } from '../services/llm-litellm.service.js';
import { ConfigService } from '../services/config.service.js';
import { ConversationService } from '../services/conversation.service.js';
import { ToolsService } from '../services/tools.service.js';
import { LocalModelService } from '../services/local-model.service.js';
import { MCPService } from '../services/mcp.service.js';
import { IndexService, geminiEmbed, openaiEmbed } from '../services/index.service.js';
import type { LocalModel } from '../types/local-model.js';
import { resolve, extname as pathExtname } from 'path';
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from 'fs';
import { markdownRenderer } from '../utils/markdown-renderer.js';
import { stickyLayout } from '../utils/sticky-layout.js';
import { toolExecutorUI } from '../utils/tool-executor-ui.js';
import { renderUnifiedDiff } from '../utils/diff-viewer.js';

// ─── ANSI / terminal helpers ─────────────────────────────────────────────────

const o = (s: string) => process.stdout.write(s);

const A = {
  r:   '\x1b[0m',
  b:   '\x1b[1m',
  d:   '\x1b[2m',
  i:   '\x1b[3m',
  cy:  '\x1b[36m',
  gr:  '\x1b[32m',
  ye:  '\x1b[33m',
  re:  '\x1b[31m',
  gy:  '\x1b[90m',
  wh:  '\x1b[97m',
  mg:  '\x1b[35m',
  bl:  '\x1b[34m',
  bgDk: '\x1b[48;5;235m',  // very dark grey background for selected row
  cl:  '\x1b[2K',
  cd:  '\x1b[J',
  up:  (n: number) => `\x1b[${n}A`,
  dn:  (n: number) => `\x1b[${n}B`,
  col: (n: number) => `\x1b[${n}G`,
};

const p   = (col: string, s: string) => `${col}${s}${A.r}`;
const esc = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');  // strip ANSI

// ─── Command registry ────────────────────────────────────────────────────────

const CMDS = [
  { cmd: '/help',       args: '',           desc: 'Show this command list'                         },
  { cmd: '/clear',      args: '',           desc: 'Clear chat history'                             },
  { cmd: '/history',    args: '',           desc: 'Print conversation so far'                      },
  { cmd: '/model',      args: '[name]',     desc: 'Show or change model  e.g. /model gpt-4o'      },
  { cmd: '/connect',    args: '<url>',      desc: 'Connect to a local/Colab model endpoint'        },
  { cmd: '/disconnect', args: '',           desc: 'Disconnect from local model, use cloud again'   },
  { cmd: '/tools',      args: '',           desc: 'Toggle tool use on/off'                         },
  { cmd: '/plan',       args: '',           desc: 'Toggle plan mode (read-only, no writes)'        },
  { cmd: '/undo',       args: '',           desc: 'Undo all file changes from last response'       },
  { cmd: '/changes',    args: '',           desc: 'Show files changed this session'                },
  { cmd: '/mcp',        args: '',           desc: 'Show connected MCP servers & tools'             },
  { cmd: '/mcp-add',    args: '<name>',     desc: 'Add an MCP server (e.g. brave-search)'          },
  { cmd: '/mcp-remove', args: '<name>',     desc: 'Remove an MCP server'                           },
  { cmd: '/index',      args: '',           desc: 'Build/refresh codebase symbol index'            },
  { cmd: '/repomap',    args: '',           desc: 'Show the repo map (symbol tree of codebase)'    },
  { cmd: '/semantic',   args: '<query>',    desc: 'Semantic search across codebase by meaning'     },
  { cmd: '/cost',       args: '',           desc: 'Show tokens + estimated cost'                   },
  { cmd: '/save',       args: '',           desc: 'Force-save session to disk'                     },
  { cmd: '/sessions',   args: '',           desc: 'List saved sessions'                            },
  { cmd: '/config',     args: '',           desc: 'Show current API config'                        },
  { cmd: '/multiline',  args: '',           desc: 'Open editor for multiline input'                 },
  { cmd: '/exit',       args: '',           desc: 'Quit (also Ctrl+C)'                             },
];

// ─── Spinner ─────────────────────────────────────────────────────────────────

class Spinner {
  private static FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private label: string;

  constructor(label = 'generating') { this.label = label; }

  start() {
    this.frame = 0;
    this._tick();
    this.timer = setInterval(() => this._tick(), 80);
  }

  private _tick() {
    const spin = Spinner.FRAMES[this.frame++ % Spinner.FRAMES.length];
    o(`\r${A.cl}  ${p(A.mg, spin)} ${p(A.gy, this.label + '…')}`);
  }

  stop(label = 'optimus') {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    o('\r' + A.cl);
    o(p(A.mg + A.b, label) + p(A.gy, ' ─ ') + A.r);
  }

  static notify(msg: string) {
    o('\r' + A.cl + p(A.gy, msg) + '\n');
  }
}

// ─── Prompt with live dropdown autocomplete ───────────────────────────────────

class Prompt {
  private buf      = '';
  private pos      = 0;
  private hist:    string[] = [];
  private histIdx  = -1;
  private histBuf  = '';

  // ── Dropdown state ──────────────────────────────────────────────────────────
  private ddItems: typeof CMDS = [];   // current filtered set
  private ddSel   = 0;                 // currently highlighted row (0-based)
  private ddOpen  = false;             // is dropdown visible?
  private cursorVisualRow = 0;         // Tracks vertical cursor offset relative to the start of prompt

  // Prefix "  ❯ " = 4 printable chars
  private static readonly PFX = 4;
  // Max rows shown in dropdown
  private static readonly MAX_DD = 16;

  constructor(
    private onLine: (line: string) => Promise<void>,
    private onExit: () => void,
  ) {}

  show() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    this._redraw();
    process.stdin.on('data', (k: string) => void this._key(k));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * INVARIANT: cursor is on the INPUT LINE when _redraw() is called,
   *            and cursor is on the INPUT LINE when _redraw() returns.
   *
   * The dropdown lives BELOW the input line:
   *   [input line]   ← cursor
   *   [dd row 0]
   *   [dd row 1]
   *   …
   *
   * To erase: walk DOWN through each old row (\n\r\x1b[2K), then walk back UP.
   * Never go above the input line — that caused the ghost copies.
   */
  private _redraw() {
    const cols = process.stdout.columns || 80;

    // ── 1. Erase old render by moving up to start of prompt and clearing down ──
    if (this.cursorVisualRow > 0) {
      o(A.up(this.cursorVisualRow));
    }
    o('\r' + A.cd);

    // ── 2. Draw the prompt line by line ──────────────────────────────────────
    const pfxStr = p(A.mg + A.b, '  ❯') + ' ';
    const firstLineLen = cols - Prompt.PFX;
    
    let remaining = this.buf;
    const linesToDraw: string[] = [];
    
    // First line (shorter due to prefix)
    linesToDraw.push(remaining.slice(0, Math.max(0, firstLineLen)));
    remaining = remaining.slice(Math.max(0, firstLineLen));
    
    // Subsequent lines
    while (remaining.length > 0) {
      linesToDraw.push(remaining.slice(0, cols));
      remaining = remaining.slice(cols);
    }
    
    for (let i = 0; i < linesToDraw.length; i++) {
      if (i === 0) o(pfxStr + linesToDraw[i]);
      else o('\n\r' + linesToDraw[i]);
    }
    
    const promptLines = linesToDraw.length;

    // ── 3. Draw the dropdown ─────────────────────────────────────────────────
    let newDdLines = 0;
    if (this.ddOpen && this.ddItems.length > 0) {
      const visible  = this.ddItems.slice(0, Prompt.MAX_DD);
      for (let i = 0; i < visible.length; i++) {
        const item       = visible[i];
        const isSelected = i === this.ddSel;
        const rawMk = isSelected ? '  ▸ ' : '    ';
        const rawCm = item.cmd.padEnd(14);
        const rawDs = item.desc;

        const mk = isSelected ? p(A.mg + A.b, rawMk) : rawMk;
        const cm = isSelected ? p(A.mg + A.b, rawCm) : p(A.gy, rawCm);
        const ds = isSelected ? p(A.wh, rawDs)        : p(A.gy + A.d, rawDs);

        o('\n\r' + A.cl + mk + cm + ds);
        newDdLines++;
      }

      if (this.ddItems.length > Prompt.MAX_DD) {
        o('\n\r' + A.cl + p(A.gy, `    + ${this.ddItems.length - Prompt.MAX_DD} more`));
        newDdLines++;
      }
    }

    // ── 4. Position cursor at correct row and col ────────────────────────────
    let targetRow = 0;
    let targetCol = Prompt.PFX + this.pos;
    if (targetCol >= cols) {
      const rem = targetCol - cols;
      targetRow = 1 + Math.floor(rem / cols);
      targetCol = rem % cols;
    }
    
    this.cursorVisualRow = targetRow;
    
    const currentPhysicalRow = (promptLines - 1) + newDdLines;
    const upDistance = currentPhysicalRow - targetRow;
    
    if (upDistance > 0) o(A.up(upDistance));
    o('\r');
    if (targetCol > 0) o(A.col(targetCol + 1)); // VT100 columns are 1-indexed
  }

  /** Erase dropdown rows (walk down then back up), reset state. */
  private _closeDropdown() {
    this.ddOpen  = false;
    this.ddItems = [];
    this.ddSel   = 0;
    this._redraw();
  }

  /** Update dropdown filter based on current buf */
  private _updateDropdown() {
    if (this.buf.startsWith('/')) {
      const parts = this.buf.split(' ');
      const typed = parts[0];
      const hasArgs = parts.length > 1; // user typed a space → entering arguments

      // If the typed command exactly matches one entry and user is entering args, close dropdown
      const exactMatch = CMDS.some(c => c.cmd === typed);
      if (exactMatch && hasArgs) {
        this.ddOpen  = false;
        this.ddItems = [];
        this.ddSel   = 0;
      } else {
        this.ddItems = CMDS.filter(c => c.cmd.startsWith(typed));
        this.ddOpen  = this.ddItems.length > 0;
        if (this.ddSel >= this.ddItems.length) this.ddSel = 0;
      }
    } else {
      this.ddOpen  = false;
      this.ddItems = [];
      this.ddSel   = 0;
    }
  }

  // ── Key handler ─────────────────────────────────────────────────────────

  private async _key(k: string) {

    // ── Ctrl shortcuts ─────────────────────────────────────────────
    if (k === '\u0003') { this._closeDropdown(); o('\n'); this.onExit(); return; }
    if (k === '\u000c') { this._ctrlL(); return; }
    if (k === '\u0017') { this._ctrlW(); return; }
    if (k === '\u0001') { this.pos = 0;                this._redraw(); return; }
    if (k === '\u0005') { this.pos = this.buf.length;  this._redraw(); return; }

    // ── Enter ──────────────────────────────────────────────────────
    if (k === '\r' || k === '\n') {
      // If dropdown is open and user presses Enter → accept highlighted suggestion
      if (this.ddOpen && this.ddItems.length > 0) {
        const chosen = this.ddItems[this.ddSel].cmd;
        this._closeDropdown();
        this.buf = chosen;
        this.pos = chosen.length;
        this._redraw();
        return;
      }

      const line = this.buf.trim();
      this._closeDropdown();
      
      // Move to the bottom of the prompt to avoid overwriting it
      const cols = process.stdout.columns || 80;
      let targetRow = 0;
      let targetCol = Prompt.PFX + this.buf.length;
      if (targetCol >= cols) {
        targetRow = 1 + Math.floor((targetCol - cols) / cols);
      }
      const downRem = targetRow - this.cursorVisualRow;
      if (downRem > 0) o(A.dn(downRem));

      o('\n');
      this.histIdx = -1; this.histBuf = '';
      this.buf = ''; this.pos = 0;
      this.cursorVisualRow = 0;
      if (!line) { this._redraw(); return; }
      this.hist.push(line);
      process.stdin.pause();
      await this.onLine(line);
      process.stdin.resume();
      this._redraw();
      return;
    }

    // ── Escape: close dropdown (keep buf) ─────────────────────────────────
    if (k === '\x1b') {
      if (this.ddOpen) this._closeDropdown();
      return;
    }

    // ── Arrow keys ────────────────────────────────────────────────
    if (k === '\x1b[A') {   // Up
      if (this.ddOpen && this.ddItems.length > 0) {
        this.ddSel = (this.ddSel - 1 + Math.min(this.ddItems.length, Prompt.MAX_DD)) % Math.min(this.ddItems.length, Prompt.MAX_DD);
        this._redraw();
      } else {
        this._histUp();
      }
      return;
    }
    if (k === '\x1b[B') {  // Down
      if (this.ddOpen && this.ddItems.length > 0) {
        this.ddSel = (this.ddSel + 1) % Math.min(this.ddItems.length, Prompt.MAX_DD);
        this._redraw();
      } else {
        this._histDown();
      }
      return;
    }
    if (k === '\x1b[D') {  // Left
      if (this.pos > 0) { this.pos--; this._updateDropdown(); this._redraw(); }
      return;
    }
    if (k === '\x1b[C') {  // Right
      if (this.pos < this.buf.length) { this.pos++; this._updateDropdown(); this._redraw(); }
      return;
    }
    if (k === '\x1b[H' || k === '\x1b[1~') { this.pos = 0;               this._redraw(); return; }
    if (k === '\x1b[F' || k === '\x1b[4~') { this.pos = this.buf.length;  this._redraw(); return; }

    // ── Tab: accept top suggestion ─────────────────────────────────
    if (k === '\t') {
      if (this.ddOpen && this.ddItems.length > 0) {
        const chosen = this.ddItems[this.ddSel].cmd;
        this._closeDropdown();
        this.buf = chosen;
        this.pos = chosen.length;
        this._updateDropdown();
        this._redraw();
      }
      return;
    }

    // ── Delete (forward) ──────────────────────────────────────────
    if (k === '\x1b[3~') {
      if (this.pos < this.buf.length) {
        this.buf = this.buf.slice(0, this.pos) + this.buf.slice(this.pos + 1);
        this._updateDropdown(); this._redraw();
      }
      return;
    }

    // ── Backspace ─────────────────────────────────────────────────
    if (k === '\x7f') {
      if (this.pos > 0) {
        this.buf = this.buf.slice(0, this.pos - 1) + this.buf.slice(this.pos);
        this.pos--;
        this._updateDropdown(); this._redraw();
      }
      return;
    }

    // ── Printable single char ──────────────────────────────────────
    if (k.length === 1 && k.charCodeAt(0) >= 32) {
      this.buf = this.buf.slice(0, this.pos) + k + this.buf.slice(this.pos);
      this.pos++;
      this._updateDropdown(); this._redraw();
      return;
    }

    // ── Paste (printable multi-char chunk) ────────────────────────
    if (k.length > 1 && !k.startsWith('\x1b')) {
      const printable = k.replace(/[^\x20-\x7e\u00a0-\uffff]/g, '');
      if (printable) {
        this.buf = this.buf.slice(0, this.pos) + printable + this.buf.slice(this.pos);
        this.pos += printable.length;
        this._updateDropdown(); this._redraw();
      }
    }
  }

  // ── History ──────────────────────────────────────────────────────

  private _histUp() {
    if (!this.hist.length) return;
    if (this.histIdx === -1) { this.histBuf = this.buf; this.histIdx = this.hist.length - 1; }
    else if (this.histIdx > 0) this.histIdx--;
    this.buf = this.hist[this.histIdx]; this.pos = this.buf.length;
    this._updateDropdown(); this._redraw();
  }

  private _histDown() {
    if (this.histIdx === -1) return;
    if (this.histIdx < this.hist.length - 1) { this.histIdx++; this.buf = this.hist[this.histIdx]; }
    else { this.histIdx = -1; this.buf = this.histBuf; }
    this.pos = this.buf.length;
    this._updateDropdown(); this._redraw();
  }

  // ── Ctrl helpers ─────────────────────────────────────────────────

  private _ctrlW() {
    if (this.pos === 0) return;
    let i = this.pos - 1;
    while (i > 0 && this.buf[i - 1] === ' ') i--;
    while (i > 0 && this.buf[i - 1] !== ' ') i--;
    this.buf = this.buf.slice(0, i) + this.buf.slice(this.pos);
    this.pos = i;
    this._updateDropdown(); this._redraw();
  }

  private _ctrlL() {
    o('\x1b[2J\x1b[H');
    this.cursorVisualRow = 0;
    this._redraw();
  }
}

// ─── Chat Command ─────────────────────────────────────────────────────────────

export default class Chat extends Command {
  static id = 'chat';
  static description = 'Optimus Chat — AI Coding Agent';

  // Ink UI integration hooks (optional)
  private inkHooks: null | {
    onState: (s: any) => void;
    onMessage: (m: any) => void;
    onTools: (t: any[]) => void;
    onDiffs: (d: any[]) => void;
    onSnapshots: (toolRunId: string, snapshots: any[]) => void;
  } = null;
  static flags = {
    model: Flags.string({ char: 'm', description: 'Model to use (overrides config default)' }),
    // legacy UI removed: Ink TUI is the only supported UI
    // legacy: Flags.boolean({ description: 'Use legacy non-Ink chat UI', default: false }),
  };

  private llm!:  LLMServiceLiteLLM;
  private conv   = new ConversationService();
  private msgs:  { role: string; content: string | any[] }[] = [];
  private toolsEnabled = true;
  private planMode     = false;
  private tokens = 0;
  private cost   = 0;
  private sessName = '';

  // ── Local model connection state ─────────────────────────────────────────────
  private localModelService: LocalModelService | null = null;
  private localModelMeta: LocalModel | null = null;

  // ── Track last tools instance for /undo ──────────────────────────────────────
  private lastTools: ToolsService | null = null;
  private projectContext: string | null = null;

  // ── MCP ──────────────────────────────────────────────────────────────────────
  private mcpService = new MCPService();

  // ── Index (Phase 3) ────────────────────────────────────────────────────────
  private indexService: IndexService | null = null;
  private repoMap: string = '';

  async run() {
    const { flags } = await this.parse(Chat);

    // Ink UI is the only supported UI
    const { runChatUI } = await import('../ui/run-chat-ui.js');
    await runChatUI();
    return;

    // Ink-only: no legacy loop

  }

  // ─── Auto-init (first-run setup) ───────────────────────────────────────────

  private async _autoInit(): Promise<boolean> {
    o('\n');
    o(p(A.cy + A.b, '  ╭────────────────────────────────────────────────╮\n'));
    o(p(A.cy + A.b, '  │') + p(A.wh + A.b, '  ⚡ Welcome to Optimus — First-Time Setup') + p(A.cy + A.b, '      │\n'));
    o(p(A.cy + A.b, '  ╰────────────────────────────────────────────────╯\n'));
    o('\n');
    o(p(A.gy, '  This takes about 10 seconds. You only need to do it once.\n\n'));

    // ── Provider selection ──
    const providers = [
      { key: '1', name: 'Google Gemini', value: 'gemini'    as const },
      { key: '2', name: 'OpenAI',        value: 'openai'    as const },
      { key: '3', name: 'Anthropic',     value: 'anthropic' as const },
    ];

    o(p(A.wh + A.b, '  Select your AI provider:\n'));
    for (const pr of providers) {
      o(p(A.gy, `    ${pr.key}) `) + p(A.wh, pr.name) + '\n');
    }
    o('\n');

    const providerKey = await this._readLineRaw(p(A.mg + A.b, '  ❯ ') + p(A.gy, 'Enter 1/2/3: '));
    const provider = providers.find(p => p.key === providerKey.trim());
    if (!provider) return false;

    o(p(A.gr, `  ✔ ${provider.name}\n\n`));

    // ── API key ──
    const apiKey = await this._readLineRaw(p(A.mg + A.b, '  ❯ ') + p(A.gy, `Enter your ${provider.name} API key: `));
    if (!apiKey.trim()) return false;
    if (!ConfigService.validateApiKey(apiKey.trim(), provider.value)) {
      o(p(A.re, `  ✗ Invalid API key format for ${provider.name}.\n`));
      return false;
    }

    o(p(A.gr, `  ✔ API key saved (${apiKey.trim().slice(0, 6)}***)\n\n`));

    // ── Workspace name ──
    const workspaceName = 'optimus-workspace';

    try {
      ConfigService.initializeWorkspace(workspaceName, provider.value, apiKey.trim());
      ConfigService.createWorkspaceStructure(workspaceName);
      o(p(A.gr + A.b, '  ✅ Setup complete! Starting Optimus...\n\n'));
      return true;
    } catch (err: any) {
      o(p(A.re, `  ✗ Setup failed: ${err.message}\n`));
      return false;
    }
  }

  /** Read a single line from stdin (raw mode, blocking). Used only for auto-init. */
  private _readLineRaw(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      o(prompt);
      let buf = '';
      process.stdin.setRawMode(false);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const handler = (data: string) => {
        buf += data;
        if (buf.includes('\n') || buf.includes('\r')) {
          process.stdin.removeListener('data', handler);
          process.stdin.pause();
          resolve(buf.replace(/[\r\n]+$/, ''));
        }
      };
      process.stdin.on('data', handler);
    });
  }

  // ─── Index helpers (Phase 3) ─────────────────────────────────────────────────

  /** Build the symbol index in the background — doesn't block startup */
  private _buildIndexBackground() {
    setTimeout(async () => {
      try {
        this.indexService = new IndexService(resolve('.'));
        const stats = await this.indexService.buildIndex();
        if (stats.files > 0 || this.repoMap === '') {
          this.repoMap = this.indexService.generateRepoMap();
          // Only notify if the prompt is not actively receiving input
          Spinner.notify(`  🗂  Index ready — ${stats.files + stats.skipped} files, ${stats.symbols} new symbols`);
        }
      } catch (err: any) {
        // Non-fatal — just skip indexing silently
      }
    }, 1500);  // Delay to let the prompt stabilize first
  }

  /** Get an embed function based on the current provider config */
  private _getEmbedFn(): ((text: string) => Promise<number[]>) | null {
    try {
      const cfg = ConfigService.loadConfig();
      const key = ConfigService.getApiKey();
      if (cfg.apiProvider === 'gemini') {
        return (t) => geminiEmbed(t, key);
      }
      if (cfg.apiProvider === 'openai') {
        return (t) => openaiEmbed(t, key);
      }
    } catch { /* no config */ }
    return null;
  }

  // ─── Planner Agent (Phase 3) ─────────────────────────────────────────────────

  /**
   * Planner Agent — fired for short or vague user queries (< 60 chars, no code).
   *
   * Makes a fast, cheap micro-call to the LLM asking:
   *   "Given this codebase map, what files/symbols should I look at to answer: <query>?"
   *
   * The planner's answer is injected as a hidden system note into the conversation
   * so the main ReAct LLM starts with a focused plan rather than exploring blindly.
   *
   * This is the same technique Claude Code uses internally before routing requests.
   * It is fully non-blocking and skipped if the repo map hasn't been built yet.
   */
  private async _plannerExpand(userQuery: string): Promise<string | null> {
    // Only run for short/vague queries without code snippets
    const isVague = userQuery.length < 80 && !userQuery.includes('```') && !userQuery.includes('\n');
    if (!isVague || !this.repoMap || !this.toolsEnabled) return null;

    try {
      const plannerSystem = `You are a senior software engineer acting as a PLANNING AGENT.
Given a vague user request and a repo map of the codebase, output a SHORT (max 5 lines) structured plan:
- Which 1-3 files are most likely relevant
- Which symbol or function to look at first
- What the key concern is

Be extremely concise. Do NOT explain. Do NOT write code. Just a bullet-point plan.`;

      const plannerPrompt = `## Repo Map\n${this.repoMap.slice(0, 2000)}\n\n## User Request\n"${userQuery}"\n\nBriefly: which files/symbols should I look at first, and what's the plan?`;

      const result = await this.llm.completeWithHistory(
        [
          { role: 'system', content: plannerSystem },
          { role: 'user',   content: plannerPrompt },
        ],
        // No callbacks — silent micro-call
      );

      const plan = result.content.trim();
      if (plan.length > 20) {
        // Track token cost
        this.tokens += result.tokensUsed?.total ?? 0;
        this.cost   += result.cost?.total ?? 0;
        return plan;
      }
    } catch {
      // Planner failure is always non-fatal — fall through to normal path
    }
    return null;
  }



  // ─── Ask the LLM ────────────────────────────────────────────────────────────

  private _renderStickyHeader() {
    stickyLayout.renderHeader({
      model: this.localModelMeta ? `⚡ ${this.localModelMeta.name}` : this.llm.getModel(),
      tokens: this.tokens,
      cost: this.cost,
      toolsEnabled: this.toolsEnabled,
      planMode: this.planMode,
      sessionName: this.sessName,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ink UI adapter API
  // ─────────────────────────────────────────────────────────────────────────

  /** Initialize chat engine without starting legacy prompt loop */
  async _initForInkUI(hooks: NonNullable<Chat['inkHooks']>) {
    this.inkHooks = hooks;
    this.llm = new LLMServiceLiteLLM();

    if (!ConfigService.isInitialized()) {
      // Ink UI can't run interactive init reliably; require user to run init command.
      throw new Error('Workspace not initialized. Run `optimus init` first.');
    }

    const cfg = ConfigService.loadConfig();
    this.sessName = `chat-${Date.now()}`;
    this.conv.createSession(this.sessName, cfg.apiProvider, this.llm.getModel());
    this.projectContext = ToolsService.readProjectContext(resolve('.'));

    // Connect MCP and index in background (best effort)
    try {
      const mcpConfigs = MCPService.loadConfig();
      if (mcpConfigs.length > 0) await this.mcpService.connectAll();
    } catch {}

    this._buildIndexBackground();

    // send state
    this.inkHooks.onState({
      tokens: this.tokens,
      cost: this.cost,
      model: this.llm.getModel(),
      sessionName: this.sessName,
      toolsEnabled: this.toolsEnabled,
      planMode: this.planMode,
    });
  }

  async _handleInkLine(line: string) {
    if (line.startsWith('/')) return this._slash(line);
    return this._ask(line);
  }

  async _inkRegenerateLast() {
    // naive: re-ask the last user message
    const lastUser = [...this.msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser || typeof lastUser.content !== 'string') return;
    await this._ask(lastUser.content);
  }

  async _inkTogglePinLast() {
    const s = this.conv.getCurrentSession();
    if (!s) return;
    const last = [...s.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
    if (!last) return;
    last.pinned = !last.pinned;
    this.conv.saveSession();
  }

  async _inkReactLast(reaction: 'up' | 'down') {
    const s = this.conv.getCurrentSession();
    if (!s) return;
    const last = [...s.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return;
    last.reactions ??= [];
    if (!last.reactions.includes(reaction)) last.reactions.push(reaction);
    this.conv.saveSession();
  }

  private async _ask(line: string) {
    // ── Check for Vision (images) ──
    const imagePaths: string[] = [];
    let cleanLine = line;

    // Detect paths like C:\\path\img.png or /path/img.png, and remove quotes if any
    const IMG_RE = /(["']?)((?:[a-zA-Z]:\\|\/)[^\s"']+\.(?:png|jpg|jpeg|webp|gif|bmp))\1/gi;
    let m;
    while ((m = IMG_RE.exec(line)) !== null) {
      const p = m[2];
      if (!imagePaths.includes(p)) imagePaths.push(p);
      cleanLine = cleanLine.replace(m[0], '').trim();
    }

    let payloadContent: string | any[] = cleanLine;
    const validImages: string[] = [];

    // Verify files exist
    for (const imgPath of imagePaths) {
      if (fsExistsSync(imgPath)) validImages.push(imgPath);
    }

    if (validImages.length > 0) {
      const parts: any[] = [{ type: 'text', text: cleanLine || 'What is in this image?' }];
      for (const imgPath of validImages) {
        const ext = pathExtname(imgPath).toLowerCase().slice(1);
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        const b64 = fsReadFileSync(imgPath).toString('base64');
        parts.push({ type: 'image_url', image_url: { url: `data:image/${mime};base64,${b64}` } });
      }
      payloadContent = parts;
      o(p(A.cy, `  📷 Detected ${validImages.length} image(s)\n`));
    }

    this.msgs.push({ role: 'user', content: payloadContent });
    this.conv.addMessage('user', payloadContent);

    // ── Planner Agent: silently expand vague queries before main LLM call ──
    // Run BEFORE the spinner so it's transparent to the user.
    // Only fires for short/vague text queries when repo map is ready.
    if (typeof payloadContent === 'string') {
      const plan = await this._plannerExpand(payloadContent);
      if (plan) {
        // Inject plan as a hidden system note — not shown to user, only to LLM
        this.msgs.push({
          role: 'system',
          content: `[PLANNER NOTE]
${plan}`,
        });
      }
    }

    const spinner = new Spinner();
    o('\n');
    spinner.start();

    let fullFinal = '';
    let started   = false;

    // For approach (1): buffer assistant output and render with markdown once complete.
    let visibleAssistantRaw = '';

    const modelLabel = this.localModelMeta
      ? this.localModelMeta.name
      : 'Optimus';

    const firstContent = (label?: string) => {
      if (!started) { started = true; spinner.stop(label ?? modelLabel); }
    };

    // ── Route through LOCAL model if connected ──────────────────────────────
    if (this.localModelService) {
      try {
        const svc = this.localModelService;
        const res = await svc.completeWithHistory(this.msgs, {
          onChunk:    (chunk) => { firstContent(); visibleAssistantRaw += chunk; fullFinal += chunk; },
          onError:    (err)   => { firstContent(); o(p(A.re, `\n  ⚠  ${err.message}`)); },
          onComplete: (r)     => {
            if (!fullFinal) fullFinal = r.content;
            if (!visibleAssistantRaw) visibleAssistantRaw = r.content;
            if (r.tokensUsed) this.tokens += r.tokensUsed.total;
          },
        });
        if (!fullFinal) {
          fullFinal = res.content;
          visibleAssistantRaw = res.content;
          firstContent();
        }

        // Render buffered assistant message as markdown (approach 1)
        const rendered = markdownRenderer.render(visibleAssistantRaw);
        o(rendered + '\n');
        this.msgs.push({ role: 'assistant', content: fullFinal });
        this.conv.addMessage('assistant', fullFinal);
        this.conv.updateMetadata(0, 0);
        this.conv.saveSession();
        this._statusLine();
        this._renderStickyHeader();
      } catch (e: any) {
        firstContent();
        o('\n' + p(A.re, `  ⚠  ${e.message}\n`));
      }
      o('\n');
      return;
    }

    // ── Cloud LLM path ──────────────────────────────────────────────────────
    try {
      const mcpSection   = this.mcpService.getTools().length > 0 ? this.mcpService.mcpToolsSection() : '';
      const repoMapSection = this.repoMap ? `\n\n${this.repoMap}` : '';
      const systemMsg = this.toolsEnabled
        ? [{ role: 'system', content: ToolsService.toolsSystemSection(this.projectContext, this.planMode) + mcpSection + repoMapSection }]
        : (this.projectContext ? [{ role: 'system', content: `You are Optimus — an expert AI coding agent.\n\n## Project Context (from OPTIMUS.md)\n${this.projectContext}${repoMapSection}` }] : []);
      let msgs = [...systemMsg, ...this.msgs];

      const MAX_LOOPS = 8;
      let loops = 0;
      const tools = new ToolsService(resolve('.'));
      tools.planMode    = this.planMode;
      // ── Inject Phase 3 index into tool executor ──
      if (this.indexService) {
        tools.indexService = this.indexService;
        tools.embedFn      = this._getEmbedFn();
      }
      this.lastTools = tools;

      let turnDeltaTokens = 0;
      let turnDeltaCost = 0;

      while (loops < MAX_LOOPS) {
        loops++;
        let full    = '';
        started     = false;
        let deltaTokens = 0;
        let deltaCost = 0;

        let filterBuf = '';
        let filterIn  = false;

        const filterChunk = (chunk: string) => {
          let text = chunk;
          
          // Silently drop planner notes from streaming output
          if (text.includes('[PLANNER NOTE')) {
            text = text.replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '');
          }

          filterBuf += text;
          let out = '';
          while (filterBuf.length > 0) {
            if (!filterIn) {
              const start = filterBuf.indexOf('<use_tool>');
              if (start === -1) {
                const safe = filterBuf.length > 10 ? filterBuf.length - 10 : 0;
                out += filterBuf.slice(0, safe);
                filterBuf = filterBuf.slice(safe);
                break;
              } else {
                out += filterBuf.slice(0, start);
                filterBuf = filterBuf.slice(start + '<use_tool>'.length);
                filterIn = true;
              }
            } else {
              const end = filterBuf.indexOf('</use_tool>');
              if (end === -1) { break; }
              filterBuf = filterBuf.slice(end + '</use_tool>'.length).replace(/^\s*\n?/, '');
              filterIn = false;
            }
          }
          if (out) { firstContent(); /* approach 1: buffer only */ visibleAssistantRaw += out; }
        };

        const res = await this.llm.completeWithHistory(msgs, {
          onChunk:    (chunk) => { filterChunk(chunk); full += chunk; },
          onComplete: (r)     => {
            this.tokens += r.tokensUsed.total;
            this.cost += r.cost.total;
            deltaTokens += r.tokensUsed.total;
            deltaCost += r.cost.total;
            turnDeltaTokens += r.tokensUsed.total;
            turnDeltaCost += r.cost.total;
          },
          onError:    (err)   => { firstContent(); o(p(A.re, `\n  ⚠  ${err.message}`)); },
        });

        if (!filterIn && filterBuf) { firstContent(); visibleAssistantRaw += filterBuf; }
        filterBuf = ''; filterIn = false;

        firstContent();
        if (!full) {
          full = res.content;
          const clean = full
            .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
            .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
            .trim();
          if (clean) visibleAssistantRaw += clean;
          this.tokens += res.tokensUsed.total;
          this.cost   += res.cost.total;
          deltaTokens += res.tokensUsed.total;
          deltaCost += res.cost.total;
          turnDeltaTokens += res.tokensUsed.total;
          turnDeltaCost += res.cost.total;
        }

        msgs.push({ role: 'assistant', content: full });
        fullFinal += (fullFinal ? '\n' : '') + full;

        if (!this.toolsEnabled) break;
        const toolCalls = ToolsService.parseToolCalls(full);
        if (!toolCalls.length) break;

        const resultParts: string[] = [];
        for (const call of toolCalls) {
          o('\n');
          const argHint = call.args.path ?? call.args.pattern ?? call.args.symbol ?? call.args.command ?? call.args.ref ?? '';

          // ── Check if this is an MCP tool ──
          if (this.mcpService.isMCPTool(call.name)) {
            Spinner.notify(`  🔌 MCP: ${call.name}`);
            const ts = new Spinner('Running');
            ts.start(); started = false;
            const mcpResult = await this.mcpService.callTool(call.name, call.args as Record<string, unknown>);
            ts.stop('Optimus');
            const body = mcpResult.isError ? `ERROR: ${mcpResult.content}` : mcpResult.content;
            resultParts.push(`<tool_result>\n<name>${call.name}</name>\n<output>\n${body}\n</output>\n</tool_result>`);
            o(p(A.gy, `  ❖ [${mcpResult.serverName}] ${mcpResult.content.slice(0, 120)}\n`));
            continue;
          }

          // ── Built-in tool ──
          if (call.name === 'run_command') {
            Spinner.notify(`  🔧 ${call.name}(${argHint})`);
            
            // Interactive Terminal Confirmation
            const ans = await this._readLineRaw(`\n  Optimus wants to run: ${p(A.wh + A.b, call.args.command)}\n  Allow? [Y/n]: `);
            if (ans.trim().toLowerCase() === 'n') {
              resultParts.push(ToolsService.formatToolResult({name: 'run_command', args: call.args, output: '', error: 'User denied permission to run this command.', durationMs: 0}));
              o(p(A.re, `  ⚠  Command denied by user.\n`));
              continue;
            }
          } else if (call.name === 'write_file') {
            Spinner.notify(`  ✏  write_file → ${call.args.path ?? '?'}`);
          } else if (call.name === 'edit_file') {
            Spinner.notify(`  ✂  edit_file → ${call.args.path ?? '?'}`);
          } else if (call.name.startsWith('git_')) {
            Spinner.notify(`  📦 ${call.name}${argHint ? `(${argHint})` : ''}`);
          } else {
            Spinner.notify(`  🔧 ${call.name}(${argHint})`);
          }
          toolExecutorUI.start(`Running ${call.name}${argHint ? ` (${argHint})` : ''}`);
          const result = await tools.execute(call);
          if (result.error) toolExecutorUI.fail(`${call.name} failed`);
          else toolExecutorUI.succeed(`${call.name} complete`);
          resultParts.push(ToolsService.formatToolResult(result));
          if (call.name !== 'write_file' && call.name !== 'edit_file') {
            o(p(A.gy, `  ❖ ${(result.output || result.error || '').slice(0, 120)}\n`));
          } else if (result.error) {
            o(p(A.re, `  ⚠  ${result.error.slice(0, 120)}\n`));
          }
        }

        msgs.push({ role: 'user', content: resultParts.join('\n\n') + '\n\nContinue with your response.' });
        o('\n' + p(A.ye + A.b, 'Optimus') + p(A.gy, ' › ') + A.r);
        started = true;
      }

      // Render assistant response once (approach 1)
      const cleanedForDisplay = visibleAssistantRaw
        .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
        .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
        .trim();
      if (cleanedForDisplay) {
        o('\n' + markdownRenderer.render(cleanedForDisplay) + '\n');
      } else {
        o('\n');
      }

      // ── Changes panel + diffs (Phase 5) ───────────────────────────────────
      const toolRunId = `toolrun-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const inkDiffs: any[] = [];
      if (tools.written.length) {
        const W  = 54;
        const HR = '─'.repeat(W);
        o('\n');
        o(p(A.gr + A.b, `  ┌${HR}┐\n`));
        o(p(A.gr + A.b,  '  │') + p(A.b + A.wh, '  ⚡ Changes') + p(A.gy, ' '.repeat(W - 11)) + p(A.gr + A.b, '│\n'));
        o(p(A.gr + A.b, `  ├${HR}┤\n`));
        for (const f of tools.written) {
          const badge   = f.isNew ? p(A.gr + A.b, '+new') : p(A.ye + A.b, '~mod');
          const lineTxt = p(A.gy, `${f.lines} lines`);
          const pathTxt = p(A.wh + A.b, f.path);
          o(p(A.gr + A.b, '  │') + `  ${badge}  ${pathTxt}  ${lineTxt}\n`);

          // Render diff if we have a snapshot
          const snap = tools.snapshots.find(s => s.relPath.replace(/\\/g, '/') === f.path.replace(/\\/g, '/'));
          if (snap) {
            try {
              const after = fsReadFileSync(f.absPath, 'utf-8');
              const before = snap.content ?? '';
              const { diffText, stats } = renderUnifiedDiff({ filePath: f.path, before, after, context: 3 });
              o(p(A.gy, `\n  Δ ${f.path} (+${stats.insertions} -${stats.deletions})\n`));
              o(diffText.split('\n').map(l => '  ' + l).join('\n') + '\n\n');
              inkDiffs.push({ path: f.path, diffText, insertions: stats.insertions, deletions: stats.deletions, toolRunId });
            } catch {
              // ignore diff failures
            }
          }
        }
        o(p(A.gr + A.b, `  ├${HR}┤\n`));
        o(p(A.gr + A.b, '  │') + p(A.gy, `  ${tools.written.length} file(s) written`) + p(A.gy, ' • /undo to revert') + '\n');
        o(p(A.gr + A.b, `  └${HR}┘\n\n`));
      }

      // Ink UI: emit tool run diffs + snapshots for per-run review
      if (this.inkHooks && inkDiffs.length) {
        this.inkHooks.onDiffs(inkDiffs);
        this.inkHooks.onSnapshots(toolRunId, tools.snapshots);
      }

      // ── Clean final message for UI & History ──
      // Drop tool calls and planner notes from the string that is saved to conversation history
      let saveString = fullFinal
        .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
        .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
        .trim();

      this.msgs.push({ role: 'assistant', content: saveString });
      this.conv.addMessage('assistant', saveString, { tokensDelta: turnDeltaTokens, costDelta: turnDeltaCost });
      this.conv.updateMetadata(this.tokens, this.cost);
      this.conv.saveSession();
      this._statusLine();

    } catch (e: any) {
      firstContent();
      o('\n' + p(A.re, `  ⚠  ${e.message}\n`));
    }
    o('\n');
  }

  // ─── Slash commands ──────────────────────────────────────────────────────────

  private async _slash(line: string) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    o('\n');

    switch (cmd) {

      // /help ──────────────────────────────────────────────────────
      case '/help': {
        const maxSig = Math.max(...CMDS.map(c => c.cmd.length + (c.args ? c.args.length + 1 : 0)));
        o(p(A.b + A.wh, '  Commands\n'));
        o(p(A.gy, '  ' + '─'.repeat(50) + '\n'));
        for (const { cmd: c, args, desc } of CMDS) {
          const sig = (c + (args ? ' ' + args : '')).padEnd(maxSig + 2);
          o(`  ${p(A.cy + A.b, sig)}  ${p(A.gy, desc)}\n`);
        }
        o('\n');
        o(p(A.gy, '  Keyboard shortcuts:\n'));
        o(p(A.gy, '  /       open command dropdown      ↑ ↓  navigate\n'));
        o(p(A.gy, '  Enter   accept selection            Tab  same\n'));
        o(p(A.gy, '  Esc     close dropdown              ↑ ↓  history (when closed)\n'));
        o(p(A.gy, '  Ctrl+W  delete word    Ctrl+L  clear screen\n'));
        o(p(A.gy, '  Ctrl+A/E  line start/end\n'));
        break;
      }

      // /clear ─────────────────────────────────────────────────────
      case '/clear': {
        this.msgs = []; this.tokens = 0; this.cost = 0;
        const cfg = ConfigService.loadConfig();
        this.sessName = `chat-${Date.now()}`;
        this.conv.createSession(this.sessName, cfg.apiProvider, this.llm.getModel());
        o(p(A.gr, '  ✔ Chat history cleared. Starting fresh session.\n'));
        break;
      }

      // /history ───────────────────────────────────────────────────
      case '/history': {
        if (!this.msgs.length) { o(p(A.gy, '  No messages yet.\n')); break; }
        o(p(A.gy, '  ' + '─'.repeat(50) + '\n'));
        // Filter out internal messages (planner notes, tool results)
        const visibleMsgs = this.msgs.filter((m) => {
          if (m.role === 'system') return false;
          const text = Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : m.content;
          if (text.includes('[PLANNER NOTE')) return false;
          if (text.includes('<tool_result>')) return false;
          return true;
        });
        visibleMsgs.forEach((m, i) => {
          const who = m.role === 'user'
            ? p(A.cy + A.b, '[You]    ')
            : p(A.ye + A.b, '[Optimus]');
          const textOnly = Array.isArray(m.content) 
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') 
            : m.content;
          const txt = textOnly.length > 200 ? textOnly.slice(0, 200) + '…' : textOnly;
          const indented = txt.replace(/\n/g, '\n           ');
          o(`  ${p(A.gy, String(i + 1).padStart(2) + '.')} ${who}  ${indented}\n`);
        });
        o(p(A.gy, '  ' + '─'.repeat(50) + '\n'));
        break;
      }

      // /model ─────────────────────────────────────────────────────
      case '/model': {
        if (rest.length) {
          this.llm.setModel(rest.join(' '));
          o(p(A.gr, `  ✔ Model changed to: `) + p(A.cy + A.b, this.llm.getModel()) + '\n');
          o(p(A.gy, '  Changes take effect from the next message.\n'));
        } else {
          o(`  Current model : ${p(A.cy + A.b, this.llm.getModel())}\n`);
          const avail = this.llm.getAvailableModels();
          if (avail.length) {
            o(`  Available     : ${p(A.gy, avail.join(', '))}\n`);
            o(p(A.gy, '  Usage: /model <name>\n'));
          }
        }
        break;
      }

      // /tools ─────────────────────────────────────────────────────
      case '/tools': {
        this.toolsEnabled = !this.toolsEnabled;
        if (this.toolsEnabled) {
          o(p(A.gr, '  ✔ Tools: ON  ') + p(A.gy, '— Optimus can read/write files, run commands\n'));
        } else {
          o(p(A.ye, '  ✔ Tools: OFF ') + p(A.gy, '— Direct chat mode (no file access)\n'));
        }
        break;
      }

      // /cost ──────────────────────────────────────────────────────
      case '/cost': {
        o(`  Tokens : ${p(A.cy + A.b, String(this.tokens))}\n`);
        o(`  Cost   : ${p(A.cy + A.b, '$' + this.cost.toFixed(6))}\n`);
        o(`  Model  : ${p(A.cy, this.llm.getModel())}\n`);
        o(`  Tools  : ${this.toolsEnabled ? p(A.gr, 'ON') : p(A.re, 'OFF')}\n`);
        break;
      }

      // /save ──────────────────────────────────────────────────────
      case '/save': {
        this.conv.saveSession();
        o(p(A.gr, `  ✔ Session saved: `) + p(A.gy, this.sessName) + '\n');
        break;
      }

      // /sessions ──────────────────────────────────────────────────
      case '/sessions': {
        const ss = this.conv.listSessions();
        if (!ss.length) { o(p(A.gy, '  No saved sessions.\n')); break; }
        o(p(A.b + A.wh, '  Saved Sessions\n'));
        o(p(A.gy, '  ' + '─'.repeat(60) + '\n'));
        ss.slice(0, 10).forEach((s, i) => {
          const date = new Date(s.updatedAt).toLocaleString();
          const cnt  = `${s.messages.length} msg${s.messages.length !== 1 ? 's' : ''}`;
          o(`  ${p(A.b, String(i + 1).padStart(2) + '.')}  ${p(A.cy, s.name.padEnd(28))} ${p(A.gy, cnt.padEnd(8))} ${p(A.gy, date)}\n`);
        });
        if (ss.length > 10) o(p(A.gy, `  … and ${ss.length - 10} more\n`));
        break;
      }

      // /config ────────────────────────────────────────────────────
      case '/config': {
        try {
          const cfg = ConfigService.loadConfig();
          const masked = '••••••••' + ConfigService.getApiKey().slice(-4);
          o(p(A.b + A.wh, '  Current Configuration\n'));
          o(p(A.gy, '  ' + '─'.repeat(40) + '\n'));
          o(`  Workspace : ${p(A.cy, cfg.workspaceName)}\n`);
          o(`  Provider  : ${p(A.cy, cfg.apiProvider.toUpperCase())}\n`);
          o(`  Model     : ${p(A.cy, this.llm.getModel())}\n`);
          o(`  API Key   : ${p(A.gy, masked)}\n`);
          o(`  Config    : ${p(A.gy, ConfigService.getConfigFile())}\n`);
          o('\n');
          o(p(A.gy, '  To change settings run:  ') + p(A.cy, 'ai config') + p(A.gy, '  (outside chat)\n'));
        } catch {
          o(p(A.re, '  ⚠  No config found. Run: ') + p(A.cy, 'ai init\n'));
        }
        break;
      }

      // /exit ──────────────────────────────────────────────────────
      case '/export': {
        const format = rest[0] as 'md' | 'json' | undefined;
        const outPath = rest.slice(1).join(' ').trim();
        if (!format || !outPath) {
          o(p(A.re, '  ⚠  Usage: /export <md|json> <path>\n'));
          break;
        }

        const session = this.conv.getCurrentSession();
        if (!session) {
          o(p(A.ye, '  ⚠  No active session to export.\n'));
          break;
        }

        try {
          const { writeFileSync } = await import('fs');
          if (format === 'json') {
            writeFileSync(outPath, JSON.stringify(session, null, 2), 'utf-8');
          } else {
            const lines: string[] = [];
            lines.push(`# ${session.name}`);
            lines.push('');
            for (const m of session.messages) {
              const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Optimus' : 'System';
              lines.push(`## ${who}`);
              lines.push('');
              const txt = Array.isArray(m.content)
                ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
                : String(m.content);
              lines.push(txt);
              lines.push('');
            }
            writeFileSync(outPath, lines.join('\n'), 'utf-8');
          }
          o(p(A.gr, `  ✔ Exported to ${outPath}\n`));
        } catch (e: any) {
          o(p(A.re, `  ⚠  Export failed: ${e.message}\n`));
        }
        break;
      }

      case '/tag': {
        const tag = rest.join(' ').trim();
        if (!tag) {
          o(p(A.re, '  ⚠  Usage: /tag <name>\n'));
          break;
        }
        const session = this.conv.getCurrentSession();
        if (!session) {
          o(p(A.ye, '  ⚠  No active session.\n'));
          break;
        }
        const last = [...session.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
        if (!last) {
          o(p(A.ye, '  ⚠  No message to tag yet.\n'));
          break;
        }
        last.tags ??= [];
        if (!last.tags.includes(tag)) last.tags.push(tag);
        this.conv.saveSession();
        o(p(A.gr, `  ✔ Tagged message with: ${tag}\n`));
        break;
      }

      case '/settings': {
        const session = this.conv.getCurrentSession();
        if (!session) {
          o(p(A.ye, '  ⚠  No active session.\n'));
          break;
        }
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false };

        const theme = (rest[0] as any) ?? session.settings.theme;
        const mode = rest[1];
        const lines = rest[2];

        if (theme === 'dark' || theme === 'light' || theme === 'high-contrast') {
          session.settings.theme = theme;
        }
        if (mode === 'compact') session.settings.compactMode = true;
        if (mode === 'normal') session.settings.compactMode = false;
        if (lines === 'lines') session.settings.showLineNumbers = true;
        if (lines === 'nolines') session.settings.showLineNumbers = false;

        this.conv.saveSession();
        o(p(A.gr, '  ✔ Settings updated\n'));
        break;
      }

      case '/exit':
      case '/quit': {
        this.conv.saveSession();
        o(p(A.gy, `\n  Session saved › ${this.sessName}\n`));
        o(p(A.ye + A.b, '  Until next time. 🤖\n\n'));
        process.exit(0);
        break;
      }

      // /connect ───────────────────────────────────────────────────
      case '/connect': {
        const rawUrl = rest.join(' ').trim();
        if (!rawUrl) {
          o(p(A.re, '  ⚠  Usage: /connect <url>\n'));
          o(p(A.gy, '  Examples:\n'));
          o(p(A.gy, '    /connect http://localhost:11434                        (Ollama local)\n'));
          o(p(A.gy, '    /connect http://localhost:8000                         (OpenAI-compatible, e.g. LM Studio)\n'));
          o(p(A.gy, '    /connect https://xxxx.ngrok-free.app                  (ngrok tunnel)\n'));
          o(p(A.gy, '    /connect https://xxxx.trycloudflare.com               (Cloudflare tunnel)\n'));
          o(p(A.gy, '    /connect https://xxxx-free.colab.research.google.com  (Google Colab)\n'));
          break;
        }

        // Normalise URL — strip trailing slash
        const endpoint = rawUrl.replace(/\/$/, '');

        // ── Auto-detect tunnel type ───────────────────────────────────────────
        let modelType: LocalModel['type'] = 'openai-compatible';
        let tunnelType: LocalModel['tunnelType'] = 'other';
        let modelName = 'default';
        let displayName = 'Local Model';
        let connected = false;
        let latencyMs = 0;

        if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) {
          tunnelType = 'localhost';
        } else if (endpoint.includes('ngrok')) {
          tunnelType = 'ngrok';
        } else if (endpoint.includes('trycloudflare') || endpoint.includes('cloudflare.dev')) {
          tunnelType = 'cloudflare';
        } else if (endpoint.includes('colab') || endpoint.includes('gradio')) {
          tunnelType = 'other';
        }

        // ── Single spinner for whole detection phase ──────────────────────────
        const detectSpinner = new Spinner('Connecting');
        detectSpinner.start();
        const t0 = Date.now();

        // 1. Probe Ollama (GET /api/tags)
        try {
          const res = await fetch(`${endpoint}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const data = await res.json() as any;
            modelType = 'ollama';
            const mods: any[] = data.models || [];
            modelName   = (Array.isArray(mods) && mods.length > 0) ? (mods[0].name || 'llama2') : 'llama2';
            displayName = `Ollama (${modelName})`;
            latencyMs   = Date.now() - t0;
            connected   = true;
          }
        } catch { /* not Ollama */ }

        // 2. Probe OpenAI-compatible (/v1/models)
        if (!connected) {
          try {
            const res = await fetch(`${endpoint}/v1/models`, {
              method: 'GET',
              signal: AbortSignal.timeout(6000),
            });
            if (res.ok) {
              const data = await res.json() as any;
              const mods: any[] = data.data || [];
              modelName   = mods.length > 0 ? (mods[0].id || 'default') : 'default';
              displayName = `OpenAI-compatible (${modelName})`;
              latencyMs   = Date.now() - t0;
              connected   = true;
            }
          } catch { /* fall through */ }
        }

        // 3. Generic fallback — just ping the base URL
        if (!connected) {
          try {
            const res = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(6000) });
            if (res.ok) {
              displayName = 'OpenAI-compatible (generic)';
              latencyMs   = Date.now() - t0;
              connected   = true;
            }
          } catch (err) {
            detectSpinner.stop('Optimus');
            o('\n');
            o(p(A.re, `  ✖ Cannot reach ${p(A.wh, endpoint)}\n`));
            o(p(A.gy, `     ${err instanceof Error ? err.message : String(err)}\n`));
            o(p(A.gy, '  Make sure your model server is running and the URL is correct.\n'));
            break;
          }
        }

        detectSpinner.stop('Optimus');
        o('\n');

        if (!connected) {
          o(p(A.re, `  ✖ No model server responded at ${p(A.wh, endpoint)}\n`));
          o(p(A.gy, '  Ensure Ollama, LM Studio, or an OpenAI-compatible server is running.\n'));
          break;
        }

        // ── Build + activate ──────────────────────────────────────────────────
        const localModel: LocalModel = {
          id:          `local-${Date.now()}`,
          name:        displayName,
          endpoint,
          type:        modelType,
          model:       modelName,
          tunnelType,
          createdAt:   new Date().toISOString(),
          isHealthy:   true,
          lastTested:  new Date().toISOString(),
        };

        try { ConfigService.addLocalModel(localModel); } catch { /* best-effort */ }

        this.localModelService = new LocalModelService(localModel);
        this.localModelMeta    = localModel;

        const latStr = latencyMs > 0 ? p(A.gy, ` (${latencyMs}ms)`) : '';
        o(p(A.gr + A.b, '  ✔ Connected!') + latStr + '\n\n');
        o(p(A.mg + A.b, '  ⚡ Now chatting with : ') + p(A.cy + A.b, displayName) + '\n');
        o(p(A.gy,       '     Endpoint         : ') + p(A.wh, endpoint) + '\n');
        o(p(A.gy,       '     Type             : ') + p(A.wh, modelType) + '\n');
        o(p(A.gy,       '     Model            : ') + p(A.wh, modelName) + '\n');
        o(p(A.gy, '  Use /disconnect to switch back to the cloud provider.\n'));
        break;
      }

      // /disconnect ────────────────────────────────────────────────
      case '/disconnect': {
        if (!this.localModelService) {
          o(p(A.ye, '  ⚡ No local model is currently connected.\n'));
          break;
        }
        const prevName = this.localModelMeta?.name ?? 'local model';
        this.localModelService = null;
        this.localModelMeta    = null;
        o(p(A.gr, `  ✔ Disconnected from ${p(A.cy + A.b, prevName)}.\n`));
        o(p(A.gy,  `  Resuming cloud provider: `) + p(A.cy + A.b, this.llm.getModel()) + '\n');
        break;
      }

      // /plan ───────────────────────────────────────────────────
      case '/plan': {
        this.planMode = !this.planMode;
        if (this.planMode) {
          o(p(A.cy + A.b, '  🔒 Plan mode ON') + p(A.gy, ' — the AI will explore and plan but NOT modify files.\n'));
          o(p(A.gy, '  Use /plan again to switch back to full mode.\n'));
        } else {
          o(p(A.gr + A.b, '  ✏  Plan mode OFF') + p(A.gy, ' — the AI can now read AND write files.\n'));
        }
        break;
      }

      // /undo ───────────────────────────────────────────────────
      case '/undo': {
        if (!this.lastTools || this.lastTools.snapshots.length === 0) {
          o(p(A.ye, '  ⚠  Nothing to undo — no files were changed in the last response.\n'));
          break;
        }
        const restored = this.lastTools.undoAll();
        if (restored.length === 0) {
          o(p(A.ye, '  ⚠  Nothing to undo.\n'));
        } else {
          o(p(A.gr + A.b, '  ↩ Undo complete:\n'));
          for (const line of restored) {
            o(p(A.gy, `    ${line}\n`));
          }
          o(p(A.gy, `  ${restored.length} file(s) restored to their previous state.\n`));
        }
        break;
      }

      // /changes ────────────────────────────────────────────────
      case '/changes': {
        if (!this.lastTools || this.lastTools.written.length === 0) {
          o(p(A.ye, '  ⚠  No files changed in this session yet.\n'));
          break;
        }
        const W  = 54;
        const HR = '─'.repeat(W);
        o(p(A.gr + A.b, `  ┌${HR}┐\n`));
        o(p(A.gr + A.b,  '  │') + p(A.b + A.wh, '  ⚡ Changes This Session') + p(A.gy, ' '.repeat(W - 24)) + p(A.gr + A.b, '│\n'));
        o(p(A.gr + A.b, `  ├${HR}┤\n`));
        for (const f of this.lastTools.written) {
          const badge   = f.isNew ? p(A.gr + A.b, '+new') : p(A.ye + A.b, '~mod');
          const lineTxt = p(A.gy, `${f.lines} lines`);
          const pathTxt = p(A.wh + A.b, f.path);
          o(p(A.gr + A.b, '  │') + `  ${badge}  ${pathTxt}  ${lineTxt}\n`);
        }
        o(p(A.gr + A.b, `  ├${HR}┤\n`));
        o(p(A.gr + A.b, '  │') + p(A.gy, `  ${this.lastTools.written.length} file(s) written • /undo to revert`) + '\n');
        o(p(A.gr + A.b, `  └${HR}┘\n`));
        break;
      }

      // /mcp ────────────────────────────────────────────────────
      case '/mcp': {
        const configs = MCPService.loadConfig();
        if (configs.length === 0) {
          o(p(A.ye + A.b, '  No MCP servers configured.\n'));
          o(p(A.gy, '  Try adding one with /mcp-add.\n'));
          break;
        }

        const W = 64;
        const HR = '─'.repeat(W);
        o(p(A.cy + A.b, `  ┌${HR}┐\n`));
        o(p(A.cy + A.b,  '  │') + p(A.b + A.wh, '  🔌 Connected MCP Servers') + p(A.gy, ' '.repeat(W - 27)) + p(A.cy + A.b, '│\n'));
        o(p(A.cy + A.b, `  ├${HR}┤\n`));

        let totalTools = 0;
        for (const cfg of configs) {
          const isConnected = this.mcpService.getConnectedCount() > 0 && this.mcpService.getTools().some(t => t.serverName === cfg.name);
          const badge = isConnected ? p(A.gr + A.b, '● online ') : (cfg.enabled ? p(A.re + A.b, '○ offline') : p(A.gy + A.b, '○ off    '));
          const toolsForServer = this.mcpService.getTools().filter(t => t.serverName === cfg.name);
          totalTools += toolsForServer.length;
          
          o(p(A.cy + A.b, '  │') + `  ${badge}  ${p(A.wh + A.b, cfg.name.padEnd(20))} ${p(A.gy, String(toolsForServer.length).padStart(3) + ' tools')}\n`);
        }
        o(p(A.cy + A.b, `  ├${HR}┤\n`));
        o(p(A.cy + A.b, '  │') + p(A.gy, `  ${this.mcpService.getConnectedCount()} server(s) running • ${totalTools} tool(s) available`) + '\n');
        o(p(A.cy + A.b, `  └${HR}┘\n`));
        break;
      }

      // /mcp-add ────────────────────────────────────────────────
      case '/mcp-add': {
        const serverName = rest[0];
        if (!serverName) {
          o(p(A.re, '  ⚠  Usage: /mcp-add <name> [command] [args...]\n'));
          o(p(A.gy, '  Examples:\n'));
          o(p(A.gy, '    /mcp-add brave-search npx -y @modelcontextprotocol/server-brave-search\n'));
          o(p(A.gy, '    /mcp-add filesystem   npx -y @modelcontextprotocol/server-filesystem /path/to/dir\n'));
          
          const popular = MCPService.getPopularServers();
          o(p(A.wh + A.b, '\n  Popular defaults (you can just type /mcp-add <name>):\n'));
          for (const s of popular) {
            o(p(A.cy, `    ${s.name.padEnd(15)}`) + p(A.gy, ` — ${s.description}\n`));
          }
          break;
        }

        // Check if it's a popular pre-configured server
        const popular = MCPService.getPopularServers().find(s => s.name === serverName);
        let command = rest[1];
        let args = rest.slice(2);
        let env: Record<string, string> | undefined = undefined;

        if (!command) {
          if (popular) {
            command = popular.command;
            args = popular.args;
            if (popular.env) {
              env = popular.env;
              // We'll prompt for env vars after adding if they are empty
            }
          } else {
            o(p(A.re, `  ⚠  No command provided and "${serverName}" is not a known popular server.\n`));
            break;
          }
        }

        // Prompt for environment variables if needed
        if (env && Object.keys(env).length > 0) {
          o(p(A.ye + A.b, `\n  This MCP server requires environment variables (e.g. API keys).\n`));
          o(p(A.gy, `  Please enter them below (or press Enter to skip and edit manually later).\n\n`));
          
          for (const key of Object.keys(env)) {
            const val = await this._readLineRaw(p(A.mg + A.b, '  ❯ ') + p(A.wh, `${key}: `));
            if (val.trim()) env[key] = val.trim();
          }
          o('\n');
        }

        const newCfg = {
          name: serverName,
          command,
          args,
          env,
          enabled: true,
        };

        MCPService.addServer(newCfg);
        o(p(A.gr + A.b, `  ✔ MCP server "${serverName}" configured.\n`));

        const ts = new Spinner('Connecting');
        ts.start();
        try {
          const discovered = await this.mcpService.connectToServer(newCfg);
          ts.stop('Optimus');
          o(p(A.gr + A.b, `  🔌 Connected! Discovered ${discovered.length} tool(s).\n`));
        } catch (e: any) {
          ts.stop('Optimus');
          o(p(A.re, `  ⚠  Saved configuration, but failed to connect:\n  ${e.message}\n`));
        }
        break;
      }

      // /mcp-remove ─────────────────────────────────────────────
      case '/mcp-remove': {
        const serverName = rest[0];
        if (!serverName) {
          o(p(A.re, '  ⚠  Usage: /mcp-remove <name>\n'));
          break;
        }

        const removed = MCPService.removeServer(serverName);
        if (removed) {
          await this.mcpService.disconnectServer(serverName);
          o(p(A.gr + A.b, `  ✔ Removed MCP server "${serverName}".\n`));
        } else {
          o(p(A.ye, `  ⚠  MCP server "${serverName}" not found in configuration.\n`));
        }
        break;
      }

      // /index ───────────────────────────────────────────────────
      case '/index': {
        if (!this.indexService) {
          this.indexService = new IndexService(resolve('.'));
        }

        // Check for --embed flag
        const doEmbed = rest.includes('--embed');

        const ts = new Spinner('Indexing');
        ts.start();
        try {
          const stats = await this.indexService.buildIndex();
          this.repoMap = this.indexService.generateRepoMap();
          ts.stop('Optimus');
          const dbStats = this.indexService.getStats();
          o('\n');
          const W = 54, HR = '─'.repeat(W);
          o(p(A.mg + A.b, `  ┌${HR}┐\n`));
          o(p(A.mg + A.b,  '  │') + p(A.b + A.wh, '  🗂  Symbol Index') + p(A.gy, ' '.repeat(W - 17)) + p(A.mg + A.b, '│\n'));
          o(p(A.mg + A.b, `  ├${HR}┤\n`));
          o(p(A.mg + A.b, '  │') + p(A.gy, `  ✔ ${stats.files} files newly indexed`) + '\n');
          o(p(A.mg + A.b, '  │') + p(A.gy, `  ✔ ${stats.skipped} files unchanged (cached)`) + '\n');
          o(p(A.mg + A.b, '  │') + p(A.gy, `  ✔ ${dbStats.symbols} total symbols indexed`) + '\n');

          // Handle --embed flag for semantic search embeddings
          if (doEmbed) {
            const embedFn = this._getEmbedFn();
            if (embedFn) {
              o(p(A.mg + A.b, '  │') + p(A.cy, `  ✴ Building embeddings...`) + '\n');
              try {
                const embeddedCount = await this.indexService.buildEmbeddings(embedFn);
                o(p(A.mg + A.b, '  │') + p(A.gr, `  ✔ ${embeddedCount} chunks embedded`) + '\n');
              } catch (embedErr: any) {
                o(p(A.mg + A.b, '  │') + p(A.re, `  ✖ Embedding failed: ${embedErr.message}`) + '\n');
              }
            } else {
              o(p(A.mg + A.b, '  │') + p(A.ye, `  ⚠ No embedding function available for provider ${ConfigService.loadConfig().apiProvider}`) + '\n');
            }
          }

          o(p(A.mg + A.b, `  └${HR}┘\n`));

          if (!doEmbed) {
            o(p(A.gy, '  Tip: Run /index --embed to enable semantic search.\n'));
          }
        } catch (e: any) {
          ts.stop('Optimus');
          o(p(A.re, `  ⚠  Indexing failed: ${e.message}\n`));
        }
        break;
      }

      // /repomap ───────────────────────────────────────────────
      case '/repomap': {
        if (!this.repoMap) {
          o(p(A.ye, '  ⚠  No repo map yet. Run /index first.\n'));
          break;
        }
        o('\n');
        o(p(A.mg + A.b, '  🗂  Repo Map\n'));
        o(p(A.gy, '─'.repeat(56) + '\n'));
        // Print first 80 lines max so it doesn't flood the terminal
        const mapLines = this.repoMap.split('\n').slice(0, 80);
        o(mapLines.map(l => '  ' + p(A.wh, l)).join('\n') + '\n');
        if (this.repoMap.split('\n').length > 80) {
          o(p(A.gy, '  ... (truncated, full map is in system prompt)\n'));
        }
        break;
      }

      // /semantic ─────────────────────────────────────────────
      case '/semantic': {
        const query = rest.join(' ');
        if (!query) {
          o(p(A.re, '  ⚠  Usage: /semantic <query>\n'));
          o(p(A.gy, '  Example: /semantic authentication logic\n'));
          break;
        }
        if (!this.indexService) {
          o(p(A.ye, '  ⚠  Run /index first to build the codebase index.\n'));
          break;
        }
        const embedFn = this._getEmbedFn();
        if (!embedFn) {
          o(p(A.ye, '  ⚠  Semantic search requires an OpenAI or Gemini API key.\n'));
          break;
        }

        const ts2 = new Spinner('Searching');
        ts2.start();
        try {
          const results = await this.indexService.semanticSearch(query, embedFn, 5);
          ts2.stop('Optimus');
          o('\n');
          if (results.length === 0) {
            o(p(A.ye, '  ⚠  No results. Run /index --embed first to build embeddings.\n'));
            break;
          }
          o(p(A.mg + A.b, `  🔍  Semantic results for: "${query}"\n\n`));
          for (const r of results) {
            o(p(A.wh + A.b, `  ${r.file}`) + p(A.gy, ` lines ${r.lines}  score: ${r.score.toFixed(3)}\n`));
            const preview = r.chunk.split('\n').slice(0, 4).join('\n');
            o(p(A.gy, '  ' + preview.replace(/\n/g, '\n  ') + '\n\n'));
          }
        } catch (e: any) {
          ts2.stop('Optimus');
          o(p(A.re, `  ⚠  Semantic search failed: ${e.message}\n`));
        }
        break;
      }

      default:
        o(p(A.re, `  Unknown command: ${p(A.b, cmd)}\n`));
        o(p(A.gy, '  Type /help or press / to see all commands.\n'));
    }
    o('\n');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private _statusLine() {
    const tTag  = this.toolsEnabled ? p(A.gr + A.b, '● tools') : p(A.gy, '○ tools');
    const pTag  = this.planMode ? p(A.cy + A.b, '  ·  🔒 plan') : '';
    const tok   = p(A.wh, String(this.tokens) + ' tok');
    const cost  = p(A.wh, '$' + this.cost.toFixed(5));
    const model = this.localModelMeta
      ? p(A.cy + A.b, '⚡ ' + this.localModelMeta.name)
      : p(A.gy, this.llm.getModel());
    const localTag = this.localModelMeta ? p(A.cy, '  ·  ') + p(A.cy + A.b, 'local') : '';
    o('\n' + p(A.gy, '  ╌╌ ') + tok + p(A.gy, '  ·  ') + cost + p(A.gy, '  ·  ') + model + p(A.gy, '  ·  ') + tTag + localTag + pTag + '\n');
  }

  private _banner() {
    const cfg = ConfigService.loadConfig();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cwd  = process.cwd();

    // ── Box geometry ────────────────────────────────────────────────────────
    // Each row looks like:  [indent]│[left:LW chars]╎[right:RW chars]│
    // Total inner width BW = LW + 1 + RW
    const LW = 30;   // left cell visible width
    const RW = 28;   // right cell visible width
    const BW = LW + 1 + RW;  // = 59 inner chars

    const bdr = (s: string) => p(A.mg, s);

    // Left cell: "  label     value   " padded to exactly LW visible chars
    const mkL = (rawLabel: string, rawValue: string): string => {
      const PFX    = '  ';
      const LBL_W  = 10;
      const rawLbl = rawLabel.padEnd(LBL_W);       // always exactly LBL_W chars
      const maxVal = LW - PFX.length - LBL_W;      // remaining space for value
      const rawVal = rawValue.slice(0, maxVal);     // truncate if too long
      const trail  = ' '.repeat(LW - PFX.length - LBL_W - rawVal.length);
      // Now apply colour — raw widths are already fixed above
      return PFX + p(A.gy, rawLbl) + p(A.wh + A.b, rawVal) + trail;
    };

    // Right cell: " content   " padded to exactly RW visible chars
    const mkR = (rawContent: string, header = false): string => {
      const PFX   = ' ';
      const maxC  = RW - PFX.length;                // remaining space
      const rawC  = rawContent.slice(0, maxC);      // truncate if too long
      const trail = ' '.repeat(RW - PFX.length - rawC.length);
      return PFX + (header ? p(A.cy + A.b, rawC) : p(A.gy, rawC)) + trail;
    };

    // Full row — left and right cells are already exactly LW and RW chars wide
    const row = (l: string, r: string) =>
      '  ' + bdr('│') + l + bdr('╎') + r + bdr('│') + '\n';

    const blank = () => row(' '.repeat(LW), ' '.repeat(RW));

    // ── Title border ─────────────────────────────────────────────────────────
    // ╭─ OPTIMUS ──────────────── AI Coding Agent ─╮
    // Total inner = BW, so dashes = BW - len(' OPTIMUS ') - 1(╌) - len(' AI Coding Agent ')
    const appName  = ' OPTIMUS ';    // 9 chars
    const tagName  = ' AI Coding Agent '; // 17 chars
    const dashFill = '─'.repeat(BW - appName.length - tagName.length - 1); // -1 for leading ─
    const topBorder = '  ' + bdr('╭─') + p(A.mg + A.b, appName)
                    + bdr(dashFill) + p(A.gy, tagName) + bdr('╮') + '\n';

    // ── Content data ─────────────────────────────────────────────────────────
    const provider  = cfg.apiProvider.toUpperCase();
    const model     = this.llm.getModel();
    const workspace = cfg.workspaceName;
    const maxCwd    = LW - 2 - 10;                   // same as mkL maxVal
    const cwdShort  = cwd.length > maxCwd ? '…' + cwd.slice(-(maxCwd - 1)) : cwd;

    const leftRows  = [
      mkL('provider', provider),
      mkL('model',    model),
      mkL('tools',    'enabled'),
      mkL('space',    workspace),
      mkL('path',     cwdShort),
    ];
    const rightRows = [
      mkR('Quick start',     true),
      mkR('/  commands'),
      mkR('↑↓  history'),
      mkR('Tab  accept cmd'),
      mkR('Esc  close menu'),
    ];

    // ── Bottom border ─────────────────────────────────────────────────────────
    // ╰ 04:48 PM ──────╯
    const footRaw  = ` ${time} `;                      // e.g. " 4:48 PM "
    const footDash = '─'.repeat(BW - footRaw.length);
    const botBorder = '  ' + bdr('╰') + p(A.gy, footRaw) + bdr(footDash) + bdr('╯') + '\n';

    // ── Output ───────────────────────────────────────────────────────────────
    o('\n');
    o(topBorder);
    o(blank());
    for (let i = 0; i < leftRows.length; i++) {
      o(row(leftRows[i], rightRows[i]));
    }
    o(blank());
    o(botBorder);
    o('\n');
  }
}

