/**
 * code command — thin CLI wrapper around AgentOrchestrator.
 *
 * All intelligence lives in the services layer.
 * This file is responsible only for:
 *   - Parsing CLI flags
 *   - Session management
 *   - Progress display
 *   - Delegating to AgentOrchestrator
 */

import { Command, Flags, Args } from '@oclif/core';
import { LLMServiceLiteLLM as LLMService } from '../services/llm-litellm.service.js';
import { ConfigService }          from '../services/config.service.js';
import { ConversationService }    from '../services/conversation.service.js';
import { AgentOrchestrator, AgentEvent } from '../services/agent-orchestrator.service.js';
import { Logger }                 from '../utils/logger.js';
import prompts from 'prompts';

export default class Code extends Command {
  static override description = 'AI coding agent — analyzes your project, plans tasks, writes code';

  static override examples = [
    '<%= config.bin %> <%= command.id %> "create a user model with name and email"',
    '<%= config.bin %> <%= command.id %> "implement complete user authentication system"',
    '<%= config.bin %> <%= command.id %> "add rate limiting to all API routes" --no-plan',
    '<%= config.bin %> <%= command.id %> "fix the bug in auth.ts" --force',
  ];

  static override args = {
    task: Args.string({
      description: 'What to build / fix / change',
      required: false,
    }),
  };

  static override flags = {
    output: Flags.string({
      char: 'o',
      description: 'Output directory (default: current directory)',
      default: '.',
    }),
    model: Flags.string({
      char: 'm',
      description: 'LLM model to use (overrides workspace config)',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Skip all confirmation prompts',
      default: false,
    }),
    'no-plan': Flags.boolean({
      description: 'Skip task decomposition — run as a single shot',
      default: false,
    }),
    'no-tools': Flags.boolean({
      description: 'Disable tool use (no ReAct loop) — faster for simple tasks',
      default: false,
    }),
    budget: Flags.integer({
      char: 'b',
      description: 'Token budget for context (default: 60000)',
      default: 60_000,
    }),
    session: Flags.string({
      char: 's',
      description: 'Session ID to resume',
    }),
    'new-session': Flags.boolean({
      description: 'Start a fresh session (ignore last session)',
      default: false,
    }),
    'list-sessions': Flags.boolean({
      description: 'List all past sessions',
      default: false,
    }),
  };

  // ─── Progress rendering ──────────────────────────────────────────────────

  private renderEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'status':
        this.log(`  ℹ  ${ev.message}`);
        break;
      case 'tool_call':
        this.log(`  🔧 ${ev.message}`);
        break;
      case 'tool_result':
        this.log(`  ✦  ${ev.message}`);
        break;
      case 'step_start': {
        const msg = ev.message;
        this.log(`\n${'─'.repeat(54)}`);
        this.log(`⚡ ${msg}`);
        break;
      }
      case 'step_done':
        this.log(`  ✔  ${ev.message}`);
        break;
      case 'file_written':
        this.log(`  ${ev.message}`);
        break;
      case 'git_commit':
        this.log(`  📦 ${ev.message}`);
        break;
      case 'error':
        this.log(`  ⚠️  ${ev.message}`);
        break;
    }
  }

  // ─── Main ────────────────────────────────────────────────────────────────

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Code);
    const task       = args.task;
    const outputDir  = flags.output;
    const forceApply = flags.force;
    const conv       = new ConversationService();

    try {
      if (!ConfigService.isInitialized()) {
        this.log('❌ Workspace not initialized. Run: node bin/dev.js init');
        process.exit(1);
      }

      // List sessions mode
      if (flags['list-sessions']) {
        this.listSessions(conv);
        return;
      }

      if (!task) {
        this.log('❌ Task description required.');
        this.log('   Usage: node bin/dev.js code "<task>"');
        process.exit(1);
      }

      // ── LLM setup ─────────────────────────────────────────────────────
      const llm = new LLMService();
      if (flags.model) llm.setModel(flags.model);

      // ── Session setup ─────────────────────────────────────────────────
      let sessionName = `code-${Date.now()}`;
      const configData = ConfigService.loadConfig();
      if (!flags['new-session']) {
        const session = flags.session
          ? conv.loadSession(flags.session)
          : conv.getLastSession();
        if (session) {
          sessionName = session.name;
          this.log(`\n📋 Continuing session: ${session.name} (${session.messages.length} messages)`);
        } else {
          conv.createSession(sessionName, configData.apiProvider, llm.getModel());
        }
      } else {
        conv.createSession(sessionName, configData.apiProvider, llm.getModel());
      }

      // ── Header ────────────────────────────────────────────────────────
      this.log('\n╔══════════════════════════════════════════════════════╗');
      this.log('║  ⚡  O P T I M U S  —  AI Coding Agent              ║');
      this.log('╚══════════════════════════════════════════════════════╝');
      this.log(`  Task   : ${task}`);
      this.log(`  Model  : ${llm.getModel()}`);
      this.log(`  Dir    : ${outputDir}`);
      this.log(`  Budget : ${flags.budget.toLocaleString()} tokens`);
      this.log(`  Plan   : ${flags['no-plan'] ? 'disabled' : 'auto (complex tasks)'}`);
      this.log(`  Tools  : ${flags['no-tools'] ? 'disabled' : 'enabled (ReAct loop)'}`);
      this.log('');


      conv.addMessage('user', task);

      // ── Confirm before long operations ────────────────────────────────
      if (!forceApply) {
        const go = await prompts({
          type: 'confirm', name: 'ok',
          message: 'Start agent? (it will read your files and write code)',
          initial: true,
        });
        if (!go.ok) { this.log('Cancelled.'); return; }
      }

      // ── Run orchestrator ──────────────────────────────────────────────
      const orchestrator = new AgentOrchestrator(llm, outputDir);
      const result = await orchestrator.run(task, {
        outputDir,
        tokenBudget:   flags.budget,
        forceApply,
        skipDecompose: flags['no-plan'] || flags['no-tools'],
        maxToolLoops:  flags['no-tools'] ? 1 : 5,
        onProgress:    (ev: AgentEvent) => this.renderEvent(ev),
      });

      // ── Save session ──────────────────────────────────────────────────
      conv.addMessage('assistant', result.steps.map(s => s.response).join('\n---\n'));
      conv.updateMetadata(result.totalTokens, result.totalCost);
      conv.saveSession();

      // ── Final result display ──────────────────────────────────────────
      this.log(AgentOrchestrator.formatResult(result));

    } catch (error) {
      Logger.error('Agent failed: ' + (error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  // ─── List sessions ────────────────────────────────────────────────────────

  private listSessions(conv: ConversationService): void {
    this.log('\n📋 Conversation Sessions\n');
    const sessions = conv.listSessions();
    if (!sessions.length) { this.log('No sessions found.\n'); return; }

    sessions.forEach((s, i) => {
      const created = new Date(s.createdAt).toLocaleString();
      const user    = s.messages.filter(m => m.role === 'user').length;
      this.log(`${i + 1}. ${s.name}`);
      this.log(`   ID: ${s.id}`);
      this.log(`   Created: ${created}`);
      this.log(`   Messages: ${s.messages.length} (${user} from you)`);
      this.log(`   Model: ${s.metadata.model}`);
      this.log(`   Cost: $${s.metadata.totalCost.toFixed(6)}`);
      this.log('');
    });
    this.log('💡 node bin/dev.js code "your task"  ← auto-continues last session\n');
  }
}
