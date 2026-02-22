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
import { VoiceService } from '../services/voice.service.js';
import { SandboxService } from '../services/sandbox.service.js';
import { DeploymentService } from '../services/deployment.service.js';
import { PolicyService } from '../services/policy.service.js';
import { MigrationService } from '../services/migration.service.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { BackupService } from '../services/backup.service.js';
import { PilotService } from '../services/pilot.service.js';
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
  private currentStep = '';

  private updateState() {
    this.inkHooks?.onState({
      tokens: this.tokens,
      cost: this.cost,
      model: this.llm.getModel(),
      sessionName: this.sessName,
      toolsEnabled: this.toolsEnabled,
      planMode: this.planMode,
      provider: ConfigService.loadConfig().apiProvider,
      step: this.currentStep,
    });
  }

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
    this.currentStep = 'Thinking';
    this.updateState();
    const check = this.policyService.isCommandAllowed(line);
    if (!check.allowed) {
      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `🛡️ POLICY BLOCK: ${check.reason}` }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

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

  private voiceService = new VoiceService();
  private sandboxService = new SandboxService();
  private deployService = new DeploymentService(resolve('.'));
  private policyService = new PolicyService(resolve('.'));
  private migrationService = new MigrationService(resolve('.'));
  private monitoringService = new MonitoringService();
  private backupService = new BackupService(resolve('.'));
  private pilotService = new PilotService();

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
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    if (cmd === '/help') {
      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: 'Use the command palette (/) in the UI. Many /commands are handled by the UI controller.' }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/pilot') {
      const aim = parts.slice(1).join(' ') || 'Pair program with me.';
      await this.pilotService.start({
        workingDir: resolve('.'),
        aim,
        onStatus: (status) => {
          this.inkHooks?.onMessage({
            id: 'pilot-status',
            role: 'assistant',
            content: [{ type: 'text', text: `✈️ **PILOT**: ${status}` }],
            timestamp: new Date().toISOString(),
          } as any);
        },
        onSuggestion: (s) => {
          this.inkHooks?.onMessage({
            id: `pilot-suggest-${Date.now()}`,
            role: 'assistant',
            content: [
              { type: 'text', text: `💡 **PILOT SUGGESTION** for \`${s.filePath}\`:` },
              { type: 'text', text: s.suggestion }
            ],
            timestamp: new Date().toISOString(),
          } as any);
        }
      });
      return;
    }

    if (cmd === '/pilot-stop') {
      this.pilotService.stop();
      this.inkHooks?.onMessage({
        id: `pilot-stop-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: '✈️ **Pilot Mode Deactivated**.' }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/attach') {
      const filePath = parts[1];
      const promptText = parts.slice(2).join(' ') || 'What is in this image?';

      if (!filePath) {
        throw new Error('Usage: /attach <path-to-image> [optional prompt]');
      }

      const { readFileSync, existsSync } = await import('fs');
      const { resolve, extname } = await import('path');

      const absPath = resolve(filePath);
      if (!existsSync(absPath)) {
        throw new Error(`File not found: ${absPath}`);
      }

      const ext = extname(absPath).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';

      const base64 = readFileSync(absPath, 'base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return this.ask(promptText, [{
        type: 'image_url',
        image_url: { url: dataUrl }
      }]);
    }

    if (cmd === '/test-driven') {
      const match = line.match(/^\/test-driven\s+"([^"]+)"\s*(.*)$/);
      if (!match) {
        throw new Error('Usage: /test-driven "<test-command>" [optional prompt]');
      }

      const testCommand = match[1];
      const promptText = match[2] || 'Fix the code to make tests pass.';

      const redGreenPrompt = `${promptText}\n\n[TEST-DRIVEN MODE]\nYour goal is to make the tests pass. The command to run the test is \`${testCommand}\`.\n1. Execute the test command using your \`run_command\` tool.\n2. Read the output.\n3. Make code changes.\n4. Run the test command again.\n5. Repeat this cycle until the test command succeeds.\n\nContinue executing tools until the test succeeds.`;

      return this.ask(redGreenPrompt);
    }

    if (cmd === '/swarm') {
      const promptText = line.replace('/swarm', '').trim();
      if (!promptText) throw new Error('Usage: /swarm <prompt>');

      const swarmPrompt = `${promptText}\n\n[SWARM MODE INITIATED]\nYou are a Swarm of 3 specialized AI agents working sequentially.\n\n1. PLANNER: First, write out a step-by-step technical plan.\n2. CODER: Second, use your tools to execute the plan.\n3. REVIEWER: Finally, critique the Coder's work and fix any bugs before finishing.\n\nExecute all three phases now.`;

      return this.ask(swarmPrompt);
    }

    if (cmd === '/voice') {
      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: '🎤 Recording... (Press Enter to stop if supported, or wait 10s)' }],
        timestamp: new Date().toISOString(),
      } as any);

      await this.voiceService.startRecording();

      // For now, let's just record for 10 seconds or until we can find a better way to trigger stop in TUI
      // In a real implementation, we'd want a key listener.
      await new Promise(r => setTimeout(r, 8000));

      const transcription = await this.voiceService.stopRecording();

      if (transcription.startsWith('Transcription failed') || transcription.startsWith('Voice transcription currently requires')) {
        this.inkHooks?.onMessage({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `❌ ${transcription}` }],
          timestamp: new Date().toISOString(),
        } as any);
        return;
      }

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `📝 Transcribed: "${transcription}"` }],
        timestamp: new Date().toISOString(),
      } as any);

      return this.ask(transcription);
    }

    if (cmd === '/sandbox') {
      const promptText = line.replace('/sandbox', '').trim();
      if (!promptText) throw new Error('Usage: /sandbox <ui-description>');

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: '🛠️ Generating UI component and starting sandbox...' }],
        timestamp: new Date().toISOString(),
      } as any);

      const llmPrompt = `Generate a single-file React component (App.tsx) for the following requirement: "${promptText}". 
      Use Tailwind or standard CSS (inline). Output ONLY the code for App.tsx. 
      Do not include explanations. Ensure it is a default export.`;

      const res = await this.llm.complete(llmPrompt, "You are a senior React developer. Output only valid TSX code.");
      const url = await this.sandboxService.updateComponent(res.content);

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [
          { type: 'text', text: `✨ Sandbox ready! You can view your component here: ${url}` },
          { type: 'text', text: `\n\`\`\`tsx\n${res.content}\n\`\`\`` }
        ],
        timestamp: new Date().toISOString(),
      } as any);

      return;
    }

    if (cmd === '/index-semantic') {
      if (!this.indexService) this.indexService = new IndexService(resolve('.'));
      const embedFn = this.getEmbedFn();
      if (!embedFn) throw new Error('No embedding function available. Check your API key and provider.');

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: '🧠 Building semantic index... this may take a few minutes for large repos.' }],
        timestamp: new Date().toISOString(),
      } as any);

      const count = await this.indexService!.buildEmbeddings(embedFn, (done: number, total: number) => {
        // We could push progress updates here if we had a dedicated UI element
      });

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `✅ Semantic index complete. Indexed ${count} code chunks.` }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/issue') {
      const url = line.replace('/issue', '').trim();
      if (!url) throw new Error('Usage: /issue <github-issue-url>');

      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `🌐 Fetching GitHub issue: ${url}...` }],
        timestamp: new Date().toISOString(),
      } as any);

      try {
        const issueMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
        if (!issueMatch) throw new Error('Invalid GitHub issue URL');

        const [_, owner, repo, num] = Array.from(issueMatch);
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${num}`;
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`GitHub API error: ${res.statusText}`);

        const data = await res.json() as any;
        const issueBody = `[GITHUB ISSUE #${num} - ${data.title}]\n\n${data.body}\n\nPlease analyze this issue and suggest/implement a fix in the current repository.`;

        return this.ask(issueBody);
      } catch (err: any) {
        throw new Error(`Failed to fetch issue: ${err.message}`);
      }
    }

    if (cmd === '/deploy') {
      const platform = parts[1];
      if (!platform) {
        const platformList = DeploymentService.PLATFORMS.map(p => `\`${p.id}\` (${p.name})`).join(', ');
        throw new Error(`Usage: /deploy <platform> [optional-goal]. Available platforms: ${platformList}`);
      }

      const goal = parts.slice(2).join(' ') || 'Deploy this application.';
      const analysis = await this.deployService.getProjectAnalysis();
      const pendingMigrations = this.migrationService.getPendingMigrations();
      const migrationSection = this.migrationService.getMigrationPrompt(pendingMigrations);

      const deployPrompt = this.deployService.getDeploymentPrompt(platform, analysis)
        .replace('{{MIGRATION_SECTION}}', migrationSection);

      const safetyPrompt = `
[SAFETY NOTICE]
If database migrations are required, use your \`run_command\` tool with \`pg_dump\` or \`mysqldump\` to create a safety snapshot before applying any changes to production.
      `.trim();

      return this.ask(`${goal}\n\n${deployPrompt}\n\n${safetyPrompt}`);
    }

    if (cmd === '/env-sync') {
      const platform = parts[1];
      const env = parts[2] || 'development';

      if (!platform) {
        throw new Error('Usage: /env-sync <platform> [environment]');
      }

      const localEnvPath = resolve(this.deployService['workingDir'], '.env');
      const localVars = this.deployService.parseEnv(localEnvPath);

      const syncPrompt = `${this.deployService.getEnvSyncPrompt(platform, env, { missingInCloud: [], diffValue: [], missingInLocal: [] })}\n\n[INSTRUCTIONS]\n1. Use \`deploy_command\` to fetch the current cloud environment variables for ${platform}.\n2. Compare them with these local values: ${JSON.stringify(localVars, null, 2)}.\n3. Identify additions, deletions, or changes.\n4. Ask for my permission before applying any updates to the cloud or local .env.`;

      return this.ask(syncPrompt);
    }

    if (cmd === '/policy') {
      const parts = line.trim().split(/\s+/);
      const sub = parts[1];
      if (sub === 'role') {
        const role = parts[2] as any;
        this.policyService.updateRole(role);
        this.inkHooks?.onMessage({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `✅ User role updated to \`${role}\`.` }],
          timestamp: new Date().toISOString(),
        } as any);
        return;
      }
      this.inkHooks?.onMessage({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `🛡️ Current Role: \`${this.policyService.getRole()}\`\nUsage: /policy role [viewer|contributor|approver|admin]` }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/vigilante-start') {
      const url = parts[1];
      if (!url) throw new Error('Usage: /vigilante-start <url>');

      this.monitoringService.start(url, 30, async (status) => {
        // AUTOMATIC RECOVERY SEQUENCE
        this.inkHooks?.onMessage({
          id: `vigilante-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `🚨 **VIGILANTE ALERT**: Production at \`${status.url}\` is DOWN!\nError: ${status.error}\n\nI am starting autonomous Root Cause Analysis...` }],
          timestamp: new Date().toISOString(),
        } as any);

        const rcaPrompt = `
[VIGILANTE MODE]
Production URL: ${status.url}
Error: ${status.error}

Tasks:
1. Use \`deploy_command\` or \`run_command\` to fetch the latest logs from the deployment provider.
2. Analyze the logs to find the exact cause of the downtime.
3. Suggest a fix (e.g., rollback, env change, or restarting pods).
4. Do NOT wait for user input — be proactive.
        `.trim();

        await this.ask(rcaPrompt);
      });

      this.inkHooks?.onMessage({
        id: `vigilante-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `🛡️ **Vigilante Mode Active**: Monitoring \`${url}\` every 30 seconds.` }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/vigilante-stop') {
      this.monitoringService.stop();
      this.inkHooks?.onMessage({
        id: `vigilante-${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `🛡️ **Vigilante Mode Deactivated**.` }],
        timestamp: new Date().toISOString(),
      } as any);
      return;
    }

    if (cmd === '/backup') {
      const url = parts[1];
      const interval = (parts[2] || 'once') as any;

      if (!url) throw new Error('Usage: /backup <db-url> [once|weekly|monthly]');

      if (interval === 'once') {
        this.inkHooks?.onMessage({
          id: `backup-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `📦 **Starting Database Backup**...` }],
          timestamp: new Date().toISOString(),
        } as any);

        const file = await this.backupService.performBackup(url);

        this.inkHooks?.onMessage({
          id: `backup-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `✅ **Backup Successful**: \`${file}\` stored in \`.multi-agent/backups/\`.` }],
          timestamp: new Date().toISOString(),
        } as any);
      } else {
        this.backupService.scheduleBackup(url, interval,
          (file) => {
            this.inkHooks?.onMessage({
              id: `backup-${Date.now()}`,
              role: 'assistant',
              content: [{ type: 'text', text: `📦 **Scheduled Backup Notice**: Automatic backup completed: \`${file}\`.` }],
              timestamp: new Date().toISOString(),
            } as any);
          },
          (err) => {
            this.inkHooks?.onMessage({
              id: `backup-${Date.now()}`,
              role: 'assistant',
              content: [{ type: 'text', text: `❌ **Scheduled Backup Failed**: ${err.message}` }],
              timestamp: new Date().toISOString(),
            } as any);
          }
        );

        this.inkHooks?.onMessage({
          id: `backup-${Date.now()}`,
          role: 'assistant',
          content: [{ type: 'text', text: `⏳ **Backup Scheduled**: Will run **${interval}** for URL: \`${url}\`.` }],
          timestamp: new Date().toISOString(),
        } as any);
      }
      return;
    }

    // Default: treat slash line as normal input for the engine.
    return this.ask(line);
  }

  private async ask(line: string, attachments: any[] = []) {
    if (!this.llm) {
      this.llm = new LLMServiceLiteLLM();
    }

    // 1. Emit + Persist User Message
    const userMsgId = `msg-${Date.now()}-user`;

    // Format content for multimodal if we have attachments
    const content = attachments.length > 0
      ? [{ type: 'text', text: line }, ...attachments]
      : line;

    this.msgs.push({ role: 'user', content });
    this.conv.addMessage('user', content);
    this.inkHooks?.onMessage({
      id: userMsgId,
      role: 'user',
      content: Array.isArray(content) ? content : [{ type: 'text', text: line }],
      timestamp: new Date().toISOString(),
    } as any);

    // 2. Prepare Context
    const mcpSection = this.mcpService.getTools().length > 0 ? this.mcpService.mcpToolsSection() : '';
    const repoMapSection = this.repoMap ? `\n\n${this.repoMap}` : '';
    const localInstructions = ToolsService.readLocalInstructions(resolve('.'), resolve('.'));

    // Semantic RAG Injection
    let semanticContext = '';
    const embedFn = this.getEmbedFn();
    if (this.indexService && embedFn && this.indexService.getStats().embeddings > 0) {
      try {
        const results = await this.indexService.semanticSearch(line, embedFn, 3);
        if (results.length > 0) {
          semanticContext = '\n\n## Relevant Code Chunks (Semantic Search)\n' +
            results.map(r => `### ${r.file} (${r.lines})\n${r.chunk}`).join('\n\n');
        }
      } catch { /* ignore RAG failures */ }
    }

    const sysText = this.toolsEnabled
      ? ToolsService.toolsSystemSection(this.projectContext, this.planMode, localInstructions) + mcpSection + repoMapSection + semanticContext
      : (this.projectContext ? `You are Optimus — an expert AI coding agent.\n\n## Project Context (from OPTIMUS.md)\n${this.projectContext}${repoMapSection}${semanticContext}${localInstructions ? `\n\n## Local Instructions\n${localInstructions}` : ''}` : '');

    const systemMsg = sysText
      ? [{ role: 'system', content: [{ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } }] }]
      : [];

    let msgs = [...systemMsg, ...this.msgs];

    // 3. Tool loop
    const MAX_LOOPS = 10;
    let loops = 0;
    const tools = new ToolsService(resolve('.'));
    tools.planMode = this.planMode;
    tools.migrationService = this.migrationService;
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
