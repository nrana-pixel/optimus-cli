/**
 * ChatEngine
 *
 * Extracted from src/commands/chat.ts to avoid instantiating an oclif Command
 * inside the Ink UI runtime. This class is UI-agnostic and can be used by
 * both the CLI command and the Ink UI.
 */

import { LLMServiceLiteLLM } from '../services/llm-litellm.service.js';
import { ConfigService } from '../services/config.service.js';
import { ConversationService } from '../services/conversation.service.js';
import { ToolsService } from '../services/tools.service.js';
import { LocalModelService } from '../services/local-model.service.js';
import { MCPService } from '../services/mcp.service.js';
import { IndexService, geminiEmbed, openaiEmbed } from '../services/index.service.js';
import type { LocalModel } from '../types/local-model.js';
import { resolve } from 'path';
import type { UIMessage, ToolRun, FileDiff } from '../ui/types.js';

export let isInkMode = false;

export type InkHooks = {
  onState: (s: any) => void;
  onMessage: (m: UIMessage) => void;
  onTools: (t: ToolRun[]) => void;
  onDiffs: (d: FileDiff[]) => void;
  onSnapshots: (toolRunId: string, snapshots: any[]) => void;
};

export class ChatEngine {
  // Ink UI integration hooks
  private inkHooks: InkHooks | null = null;

  private llm!: LLMServiceLiteLLM;
  public conv = new ConversationService();
  private msgs: { role: string; content: string | any[] }[] = [];
  private toolsEnabled = true;
  private planMode = false;
  private tokens = 0;
  private cost = 0;
  private sessName = '';

  // Local model connection state
  private localModelService: LocalModelService | null = null;
  private localModelMeta: LocalModel | null = null;

  // Track last tools instance for /undo
  private lastTools: ToolsService | null = null;

  /** Revert all file changes from the last tool run (if any) */
  revertAll(): string[] {
    if (!this.lastTools) return [];
    return this.lastTools.undoAll();
  }

  /** Revert a single file from the last tool run (if a snapshot exists) */
  async revertFile(relPath: string): Promise<boolean> {
    if (!this.lastTools) return false;
    const snaps = this.lastTools.snapshots ?? [];
    const target = relPath.replace(/\\/g, '/');
    const snap = snaps.find((s: any) => String(s.relPath ?? '').replace(/\\/g, '/') === target);
    if (!snap) return false;

    try {
      const { writeFileSync, existsSync, unlinkSync } = await import('fs');
      if (snap.existed && snap.content !== null) {
        writeFileSync(snap.absPath, snap.content, 'utf-8');
      } else if (!snap.existed && existsSync(snap.absPath)) {
        unlinkSync(snap.absPath);
      }
      return true;
    } catch {
      return false;
    }
  }
  private projectContext: string | null = null;

  // MCP
  private mcpService = new MCPService();

  // Index
  private indexService: IndexService | null = null;
  private repoMap: string = '';

  /** Initialize chat engine without starting a prompt loop (Ink UI uses this) */
  async initForInkUI(hooks: InkHooks) {
    isInkMode = true;
    this.inkHooks = hooks;
    this.llm = new LLMServiceLiteLLM();

    if (!ConfigService.isInitialized()) {
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
    } catch {
      // ignore
    }

    this.buildIndexBackground();

    this.inkHooks.onState({
      tokens: this.tokens,
      cost: this.cost,
      model: this.llm.getModel(),
      sessionName: this.sessName,
      toolsEnabled: this.toolsEnabled,
      planMode: this.planMode,
    });
  }

  async handleInkLine(line: string) {
    if (line.startsWith('/')) return this.slash(line);
    return this.ask(line);
  }

  getCurrentSession() {
    return this.conv.getCurrentSession();
  }

  loadSession(id: string) {
    return this.conv.loadSession(id);
  }

  deleteSession(id: string) {
    return this.conv.deleteSession(id);
  }

  saveSession() {
    return this.conv.saveSession();
  }

  async regenerateLast() {
    const s = this.conv.getCurrentSession();
    if (!s) return;
    const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
    const lastAssistantIdx = [...s.messages].reverse().findIndex((m) => m.role === 'assistant');
    if (!lastUser || lastAssistantIdx < 0) return;

    // Remove last assistant message and rerun last user prompt.
    const realAIdx = s.messages.length - 1 - lastAssistantIdx;
    s.messages.splice(realAIdx, 1);
    this.conv.saveSession();

    if (typeof lastUser.content === 'string') {
      await this.ask(lastUser.content);
    }
  }

  async togglePinLast() {
    const s = this.conv.getCurrentSession();
    if (!s) return;
    const last = [...s.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
    if (!last) return;
    (last as any).pinned = !(last as any).pinned;
    this.conv.saveSession();
  }

  async reactLast(reaction: 'up' | 'down') {
    const s = this.conv.getCurrentSession();
    if (!s) return;
    const last = [...s.messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return;
    (last as any).reactions ??= [];
    if (!(last as any).reactions.includes(reaction)) (last as any).reactions.push(reaction);
    this.conv.saveSession();
  }

  // -----------------
  // Internal helpers
  // -----------------

  private buildIndexBackground() {
    setTimeout(async () => {
      try {
        this.indexService = new IndexService(resolve('.'));
        const stats = await this.indexService.buildIndex();
        if (stats.files > 0 || this.repoMap === '') {
          this.repoMap = this.indexService.generateRepoMap();
        }
      } catch {
        // non-fatal
      }
    }, 1500);
  }

  private getEmbedFn(): ((text: string) => Promise<number[]>) | null {
    try {
      const cfg = ConfigService.loadConfig();
      const key = ConfigService.getApiKey();
      if (cfg.apiProvider === 'gemini') return (t) => geminiEmbed(t, key);
      if (cfg.apiProvider === 'openai') return (t) => openaiEmbed(t, key);
    } catch {
      // ignore
    }
    return null;
  }

  private async slash(line: string) {
    // For Ink UI we keep slash commands minimal; the UI itself implements many commands.
    // Forward unknown slash commands to the model (as a normal ask) so agent can respond.
    const cmd = line.trim().split(/\s+/)[0];
    if (cmd === '/help') {
      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Use the command palette (/) in the UI. Many /commands are handled by the UI controller.',
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }
    // Default: treat slash line as normal input for the engine.
    return this.ask(line);
  }

  private async ask(line: string) {
    if (!this.llm) {
      this.llm = new LLMServiceLiteLLM();
    }

    // Persist + emit user message
    this.msgs.push({ role: 'user', content: line });
    this.conv.addMessage('user', line);
    this.inkHooks?.onMessage({
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: line,
      timestamp: new Date().toISOString(),
    } as any);

    // Build system context
    const mcpSection = this.mcpService.getTools().length > 0 ? this.mcpService.mcpToolsSection() : '';
    const repoMapSection = this.repoMap ? `\n\n${this.repoMap}` : '';
    const systemMsg = this.toolsEnabled
      ? [{ role: 'system', content: ToolsService.toolsSystemSection(this.projectContext, this.planMode) + mcpSection + repoMapSection }]
      : (this.projectContext ? [{ role: 'system', content: `You are Optimus — an expert AI coding agent.\n\n## Project Context (from OPTIMUS.md)\n${this.projectContext}${repoMapSection}` }] : []);

    let msgs = [...systemMsg, ...this.msgs];

    // Tool loop
    const MAX_LOOPS = 8;
    let loops = 0;

    const tools = new ToolsService(resolve('.'));
    tools.planMode = this.planMode;
    if (this.indexService) {
      tools.indexService = this.indexService;
      tools.embedFn = this.getEmbedFn();
    }
    this.lastTools = tools;

    let fullFinal = '';
    let turnDeltaTokens = 0;
    let turnDeltaCost = 0;

    while (loops < MAX_LOOPS) {
      loops++;
      const res = await this.llm.completeWithHistory(msgs);
      this.tokens += res.tokensUsed.total;
      this.cost += res.cost.total;
      turnDeltaTokens += res.tokensUsed.total;
      turnDeltaCost += res.cost.total;

      const full = res.content;
      msgs.push({ role: 'assistant', content: full });
      fullFinal += (fullFinal ? '\n' : '') + full;

      if (!this.toolsEnabled) break;
      const toolCalls = ToolsService.parseToolCalls(full);
      if (!toolCalls.length) break;

      const resultParts: string[] = [];
      for (const call of toolCalls) {
        // MCP tool routing
        if (this.mcpService.isMCPTool(call.name)) {
          const mcpResult = await this.mcpService.callTool(call.name, call.args as Record<string, unknown>);
          const body = mcpResult.isError ? `ERROR: ${mcpResult.content}` : mcpResult.content;
          resultParts.push(`<tool_result>\n<name>${call.name}</name>\n<output>\n${body}\n</output>\n</tool_result>`);
          continue;
        }

        const result = await tools.execute(call);
        resultParts.push(ToolsService.formatToolResult(result));
      }

      msgs.push({ role: 'user', content: resultParts.join('\n\n') + '\n\nContinue with your response.' });
    }

    const saveString = fullFinal
      .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
      .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
      .trim();

    this.msgs.push({ role: 'assistant', content: saveString });
    this.conv.addMessage('assistant', saveString, { tokensDelta: turnDeltaTokens, costDelta: turnDeltaCost });
    this.conv.updateMetadata(this.tokens, this.cost);
    this.conv.saveSession();

    this.inkHooks?.onMessage({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: saveString,
      timestamp: new Date().toISOString(),
    } as any);

    // Emit updated state
    this.inkHooks?.onState({
      tokens: this.tokens,
      cost: this.cost,
      model: this.llm.getModel(),
      sessionName: this.sessName,
      toolsEnabled: this.toolsEnabled,
      planMode: this.planMode,
    });
  }
}
