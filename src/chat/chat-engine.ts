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
  onPermissionRequest: (calls: any[], previews?: FileDiff[]) => Promise<PermissionResult>;
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
      provider: cfg.apiProvider,
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

    // 1. Emit + Persist User Message
    const userMsgId = `msg-${Date.now()}-user`;
    this.msgs.push({ role: 'user', content: line });
    this.conv.addMessage('user', line);
    this.inkHooks?.onMessage({
      id: userMsgId,
      role: 'user',
      content: [{ type: 'text', text: line }],
      timestamp: new Date().toISOString(),
    } as any);

    // 2. Prepare Context
    const mcpSection = this.mcpService.getTools().length > 0 ? this.mcpService.mcpToolsSection() : '';
    const repoMapSection = this.repoMap ? `\n\n${this.repoMap}` : '';
    const localInstructions = ToolsService.readLocalInstructions(resolve('.'), resolve('.'));

    const systemMsg = this.toolsEnabled
      ? [{ role: 'system', content: ToolsService.toolsSystemSection(this.projectContext, this.planMode, localInstructions) + mcpSection + repoMapSection }]
      : (this.projectContext ? [{ role: 'system', content: `You are Optimus — an expert AI coding agent.\n\n## Project Context (from OPTIMUS.md)\n${this.projectContext}${repoMapSection}${localInstructions ? `\n\n## Local Instructions\n${localInstructions}` : ''}` }] : []);

    let msgs = [...systemMsg, ...this.msgs];

    // 3. Tool loop
    const MAX_LOOPS = 10;
    let loops = 0;
    const tools = new ToolsService(resolve('.'));
    tools.planMode = this.planMode;
    if (this.indexService) {
      tools.indexService = this.indexService;
      tools.embedFn = this.getEmbedFn();
    }
    this.lastTools = tools;

    const nativeTools = [...ToolsService.getNativeTools(this.planMode), ...this.mcpService.getNativeTools()];
    let turnWrittenCount = 0;

    while (loops < MAX_LOOPS) {
      loops++;
      const assistantMsgId = `msg-${Date.now()}-assistant-${loops}`;
      let currentAssistantContent = '';

      // Create a fresh stream for this turn
      const stream = new StreamController({
        onEmit: (uiText) => {
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

      const res = await this.llm.completeWithHistory(msgs, {
        onChunk: (chunk) => {
          currentAssistantContent += chunk;
          stream.push(chunk);
        }
      }, this.toolsEnabled ? nativeTools : undefined);

      stream.finalize();
      this.tokens += res.tokensUsed.total;
      this.cost += res.cost.total;

      const full = res.content;
      msgs.push({ role: 'assistant', content: full });
      this.msgs.push({ role: 'assistant', content: full });
      
      this.conv.addMessage('assistant', full, { id: assistantMsgId, tokensDelta: res.tokensUsed.total, costDelta: res.cost.total });
      this.conv.updateMetadata(this.tokens, this.cost);
      this.conv.saveSession();

      // Helper to generate diffs for messages
      const getDiffBlocks = async (files: any[]) => {
        const blocks: any[] = [];
        for (const writtenFile of files) {
          try {
            const snapshot = this.lastTools?.snapshots.find(s => s.absPath === writtenFile.absPath);
            const oldContent = snapshot?.existed ? snapshot.content || '' : '';
            const { readFileSync } = await import('fs');
            const newContent = readFileSync(writtenFile.absPath, 'utf-8');
            const diffText = createTwoFilesPatch(writtenFile.path, writtenFile.path, oldContent, newContent, '', '', { context: 3 });
            
            const lines = diffText.split('\n');
            const insertions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
            const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

            blocks.push({ 
                type: 'diff', 
                path: writtenFile.path, 
                diffText, 
                language: writtenFile.path.split('.').pop() || 'text',
                insertions,
                deletions
            });
          } catch { }
        }
        return blocks;
      };

      const cleanedFinal = full
        .replace(/<use_tool>[\s\S]*?<\/use_tool>\s*/g, '')
        .replace(/\[PLANNER NOTE[\s\S]*?\]\n?/g, '')
        .trim();

      const turnWritten = tools.written.slice(turnWrittenCount);
      turnWrittenCount = tools.written.length;
      
      const diffBlocks = await getDiffBlocks(turnWritten);
      const assistantContentBlocks = [{ type: 'text', text: cleanedFinal }, ...diffBlocks];

      this.inkHooks?.onMessage({
        id: assistantMsgId,
        role: 'assistant',
        content: assistantContentBlocks,
        timestamp: new Date().toISOString(),
      } as any);

      // Persist the cleaned version with diffs for the UI
      this.conv.updateMessage(assistantMsgId, { content: assistantContentBlocks });
      this.conv.saveSession();

      if (!this.toolsEnabled) break;
      const toolCalls = res.toolCalls || [];
      if (!toolCalls.length) break;

      // --- PERMISSION ---
      let approved = true;
      let needsPermission = false;
      if (this.inkHooks && !this.planMode && !this.sessionPermissionGranted) {
        if (this.autonomyMode === 'interactive' || (this.autonomyMode === 'on-failure' && this.lastTurnHadError)) {
          needsPermission = true;
        }
      }

      if (needsPermission) {
        const permMsgId = `msg-${Date.now()}-perm-${loops}`;
        
        // Generate previews
        const previewResults = await Promise.all(toolCalls.map(c => tools.preview(c as any)));
        const previewDiffs = previewResults.filter((r): r is NonNullable<typeof r> => r !== null);

        const permContent = [{ 
            type: 'permission-request', 
            calls: toolCalls, 
            status: 'pending' as const,
            previewDiffs 
        }];
        
        this.inkHooks?.onMessage({
          id: permMsgId,
          role: 'system',
          content: permContent,
          timestamp: new Date().toISOString(),
        } as any);
        
        this.conv.addMessage('system', permContent, { id: permMsgId });
        this.conv.saveSession();

        const result = await this.inkHooks!.onPermissionRequest(toolCalls, previewDiffs as any);
        let decisionStatus: 'approved' | 'denied' = 'approved';

        if (result === 'no') {
          approved = false;
          decisionStatus = 'denied';
          msgs.push({ role: 'user', content: 'Tool execution was denied by the user.' });
        } else if (result === 'always') {
          this.sessionPermissionGranted = true;
        } else if (typeof result === 'object' && result.type === 'feedback') {
          approved = false;
          decisionStatus = 'denied';
          msgs.push({ role: 'user', content: `Tool execution denied. User feedback: ${result.text}` });
        }

        const updatedContent = [{ type: 'permission-request', calls: toolCalls, status: decisionStatus }];
        this.inkHooks?.onMessage({
          id: permMsgId,
          role: 'system',
          content: updatedContent,
          timestamp: new Date().toISOString(),
        } as any);

        this.conv.updateMessage(permMsgId, { content: updatedContent });
        this.conv.saveSession();
      }

      if (!approved) {
        this.lastTurnHadError = false;
        break;
      }

      // Execute Tools
      let hasError = false;
      const toolRuns: ToolRun[] = [];
      const resultPromises = toolCalls.map(async (call) => {
        const startedAt = Date.now();
        const trId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        
        // Emit running status
        toolRuns.push({ id: trId, name: call.name, label: call.name, status: 'running', startedAt });
        this.inkHooks?.onTools([...toolRuns]);

        let result: any;
        if (this.mcpService.isMCPTool(call.name)) {
          const mcpResult = await this.mcpService.callTool(call.name, call.args as Record<string, unknown>);
          if (mcpResult.isError) hasError = true;
          result = { output: mcpResult.content, error: mcpResult.isError ? mcpResult.content : undefined };
        } else {
          result = await tools.execute({ name: call.name as any, args: call.args });
          if (result.error || (call.name === 'run_command' && result.output.includes('Command failed:'))) hasError = true;
        }

        // Update tool run status
        const runIdx = toolRuns.findIndex(r => r.id === trId);
        if (runIdx >= 0) {
            toolRuns[runIdx].status = result.error ? 'error' : 'success';
            toolRuns[runIdx].endedAt = Date.now();
            toolRuns[runIdx].error = result.error;
            this.inkHooks?.onTools([...toolRuns]);
        }

        return ToolsService.formatToolResult({
            name: call.name as any,
            args: call.args,
            output: result.output || '',
            error: result.error,
            durationMs: Date.now() - startedAt
        });
      });

      const resultParts = await Promise.all(resultPromises);
      this.lastTurnHadError = hasError;

      // Update global diffs for the UI (DiffPanel)
      const postToolWritten = tools.written.slice(turnWrittenCount);
      if (postToolWritten.length > 0) {
          const diffs = await getDiffBlocks(postToolWritten);
          this.inkHooks?.onDiffs(diffs as any);
      }

      msgs.push({ role: 'user', content: resultParts.join('\n\n') + '\n\nContinue with your response.' });
    }
    
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
