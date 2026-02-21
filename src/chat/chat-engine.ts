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
import { createTwoFilesPatch } from 'diff';
import { StreamController } from '../utils/stream-controller.js';
import type { UIMessage, ToolRun, FileDiff } from '../ui/types.js';

export let isInkMode = false;

export type PermissionResult = 'yes' | 'no' | 'always' | { type: 'feedback'; text: string };

export type InkHooks = {
  onState: (s: any) => void;
  onMessage: (m: UIMessage) => void;
  onPartialMessage: (m: UIMessage) => void;
  onTools: (t: ToolRun[]) => void;
  onDiffs: (d: FileDiff[]) => void;
  onSnapshots: (toolRunId: string, snapshots: any[]) => void;
  onPermissionRequest: (calls: any[]) => Promise<PermissionResult>;
};

export class ChatEngine {
  // Ink UI integration hooks
  private inkHooks: InkHooks | null = null;

  private llm!: LLMServiceLiteLLM;
  public conv = new ConversationService();
  private msgs: { role: string; content: string | any[] }[] = [];
  private toolsEnabled = true;
  private planMode = false;
  private sessionPermissionGranted = false;
  private autonomyMode: 'interactive' | 'trusted' | 'on-failure' = 'interactive';
  private lastTurnHadError = false;
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
    this.autonomyMode = cfg.autonomyMode || 'interactive';
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

    // Extract text from content blocks
    const lastUserText = Array.isArray(lastUser.content)
      ? lastUser.content.map((c: any) => c.text || '').join('\n')
      : String(lastUser.content);

    if (lastUserText) {
      await this.ask(lastUserText);
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
        content: [{ type: 'text', text: 'Use the command palette (/) in the UI. Many /commands are handled by the UI controller.' }],
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
      content: [{ type: 'text', text: line }],
      timestamp: new Date().toISOString(),
    } as any);

    // Build system context
    const mcpSection = this.mcpService.getTools().length > 0 ? this.mcpService.mcpToolsSection() : '';
    const repoMapSection = this.repoMap ? `\n\n${this.repoMap}` : '';
    
    // Read hierarchical local instructions (AGENTS.md)
    const localInstructions = ToolsService.readLocalInstructions(resolve('.'), resolve('.'));

    const systemMsg = this.toolsEnabled
      ? [{ role: 'system', content: ToolsService.toolsSystemSection(this.projectContext, this.planMode, localInstructions) + mcpSection + repoMapSection }]
      : (this.projectContext ? [{ role: 'system', content: `You are Optimus — an expert AI coding agent.\n\n## Project Context (from OPTIMUS.md)\n${this.projectContext}${repoMapSection}${localInstructions ? `\n\n## Local Instructions\n${localInstructions}` : ''}` }] : []);

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

    const nativeTools = [...ToolsService.getNativeTools(this.planMode), ...this.mcpService.getNativeTools()];

    let fullFinal = '';
    let turnDeltaTokens = 0;
    let turnDeltaCost = 0;

    let currentAssistantContent = '';
    const assistantMsgId = `msg-${Date.now()}-assistant`;

    // Adaptive Stream Controller
    const stream = new StreamController({
      onEmit: (uiText) => {
        // Strip internal tags before sending to UI
        const cleanedText = uiText
          .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
          .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
          .trim();

        this.inkHooks?.onPartialMessage({
          id: assistantMsgId,
          role: 'assistant',
          content: [{ type: 'text', text: cleanedText }],
          timestamp: new Date().toISOString(),
        } as any);
      }
    });

    while (loops < MAX_LOOPS) {
      loops++;
      
      const res = await this.llm.completeWithHistory(msgs, {
        onChunk: (chunk) => {
          currentAssistantContent += chunk;
          stream.push(chunk);
        }
      }, this.toolsEnabled ? nativeTools : undefined);

      stream.finalize();
      this.tokens += res.tokensUsed.total;
      this.cost += res.cost.total;
      turnDeltaTokens += res.tokensUsed.total;
      turnDeltaCost += res.cost.total;

      const full = res.content;
      msgs.push({ role: 'assistant', content: full });
      fullFinal += (fullFinal ? '\n' : '') + full;

      if (!this.toolsEnabled) break;
      const toolCalls = res.toolCalls || [];
      if (!toolCalls.length) break;

      // --- PERMISSION CHECK ---
      let approved = true;
      let needsPermission = false;

      if (this.inkHooks && !this.planMode && !this.sessionPermissionGranted) {
        if (this.autonomyMode === 'interactive') {
          needsPermission = true;
        } else if (this.autonomyMode === 'on-failure' && this.lastTurnHadError) {
          needsPermission = true;
        }
      }

      if (needsPermission) {
        const result = await this.inkHooks!.onPermissionRequest(toolCalls);
        if (result === 'no') {
          approved = false;
          msgs.push({ role: 'user', content: 'Tool execution was denied by the user. Do not try again unless asked.' });
        } else if (result === 'always') {
          this.sessionPermissionGranted = true;
          approved = true;
        } else if (typeof result === 'object' && result.type === 'feedback') {
          approved = false;
          msgs.push({ role: 'user', content: `Tool execution denied. User feedback: ${result.text}` });
        } else {
          approved = true;
        }
      }

      if (!approved) {
        this.lastTurnHadError = false;
        break;
      }

      // Execute each tool call IN PARALLEL
      let hasError = false;
      const resultPromises = toolCalls.map(async (call) => {
        // MCP tool routing
        if (this.mcpService.isMCPTool(call.name)) {
          const mcpResult = await this.mcpService.callTool(call.name, call.args as Record<string, unknown>);
          if (mcpResult.isError) hasError = true;
          const body = mcpResult.isError ? `ERROR: ${mcpResult.content}` : mcpResult.content;
          return `<tool_result>\n<name>${call.name}</name>\n<output>\n${body}\n</output>\n</tool_result>`;
        }

        // Native ToolsService routing
        const result = await tools.execute({ name: call.name as any, args: call.args });
        if (result.error || (call.name === 'run_command' && result.output.includes('Command failed:'))) {
          hasError = true;
        }
        return ToolsService.formatToolResult(result);
      });

      const resultParts = await Promise.all(resultPromises);
      this.lastTurnHadError = hasError;
      msgs.push({ role: 'user', content: resultParts.join('\n\n') + '\n\nContinue with your response.' });
    }
    const finalContentBlocks: import('../ui/types.js').ContentBlock[] = [];
    if (fullFinal) {
      finalContentBlocks.push({ type: 'text', text: fullFinal });
    }

    // Generate diffs for any written files
    if (tools.written.length > 0) {
      for (const writtenFile of tools.written) {
        const snapshot = tools.snapshots.find(s => s.absPath === writtenFile.absPath);
        const oldContent = snapshot?.existed ? snapshot.content || '' : '';
        const newContent = (await import('fs')).readFileSync(writtenFile.absPath, 'utf-8');
        
        const diffText = createTwoFilesPatch(
          writtenFile.path,
          writtenFile.path,
          oldContent,
          newContent,
          '',
          '',
          { context: 3 }
        );

        finalContentBlocks.push({
          type: 'diff',
          path: writtenFile.path,
          diffText,
          language: writtenFile.path.split('.').pop() || 'text'
        });
      }
    }

    this.msgs.push({ role: 'assistant', content: fullFinal });
    this.conv.addMessage('assistant', fullFinal, { tokensDelta: turnDeltaTokens, costDelta: turnDeltaCost });
    this.conv.updateMetadata(this.tokens, this.cost);
    this.conv.saveSession();

    this.inkHooks?.onMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: finalContentBlocks,
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
