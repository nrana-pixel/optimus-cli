/**
 * Agent Orchestrator
 *
 * The central pipeline that coordinates ALL services into a single,
 * production-grade coding agent flow — following AGENT_CONTEXT_ROADMAP.md.
 *
 * Pipeline:
 *   Task input
 *     → 1. Project analysis    (AnalyzerService)
 *     → 2. Smart context       (ContextBuilderService)
 *     → 3. Complexity check    (TaskAnalyzerService)
 *     → 4. Git backup          (GitService)
 *     → 5a. Simple/Medium:     Single-shot with tool use (ReAct loop)
 *     → 5b. Complex:           Decompose → execute each step with tools
 *     → 6. Write files
 *     → 7. Git commit per step
 *     → 8. Return AgentResult
 */

import { resolve, relative, isAbsolute, normalize } from 'path';

import { LLMServiceLiteLLM }              from './llm-litellm.service.js';
import { AnalyzerService }                from './analyzer.service.js';
import { ContextBuilderService }          from './context-builder.service.js';
import { TaskAnalyzerService, SubTask, SubTaskResult } from './task-analyzer.service.js';
import { GitService }                     from './git.service.js';
import { ToolsService, ToolCall, ToolResult } from './tools.service.js';
import { ConfigService }                  from './config.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentOptions {
  outputDir:      string;
  tokenBudget?:   number;          // default 60_000
  forceApply?:    boolean;
  skipDecompose?: boolean;
  maxToolLoops?:  number;          // default 5
  onProgress?:   (ev: AgentEvent) => void;
}

export interface AgentEvent {
  type:    'status' | 'tool_call' | 'tool_result' | 'step_start' | 'step_done' | 'file_written' | 'git_commit' | 'error';
  message: string;
  data?:   Record<string, unknown>;
}

export interface StepResult {
  subtask:     SubTask | null;
  files:       string[];
  commits:     string[];
  tokens:      number;
  cost:        number;
  toolCalls:   ToolResult[];
  response:    string;
  skipped:     boolean;
}

export interface AgentResult {
  task:           string;
  complexity:     string;
  steps:          StepResult[];
  filesWritten:   string[];
  commits:        string[];
  backupBranch:   string;
  totalTokens:    number;
  totalCost:      number;
  durationMs:     number;
}

// ─── AgentOrchestrator ────────────────────────────────────────────────────

export class AgentOrchestrator {
  private llm:           LLMServiceLiteLLM;
  private analyzer:      AnalyzerService;
  private ctxBuilder:    ContextBuilderService | null;
  private taskAnalyzer:  TaskAnalyzerService;
  private git:           GitService;
  private tools:         ToolsService;

  constructor(llm: LLMServiceLiteLLM, workingDir: string) {
    this.llm          = llm;
    this.analyzer     = new AnalyzerService();
    this.ctxBuilder   = null;
    this.taskAnalyzer = new TaskAnalyzerService();
    this.git          = new GitService(workingDir);
    this.tools        = new ToolsService(workingDir);
  }

  // ─── Main entry point ───────────────────────────────────────────────────

  async run(task: string, opt: AgentOptions): Promise<AgentResult> {
    const startTime    = Date.now();
    const outputDir    = resolve(opt.outputDir);
    const tokenBudget  = opt.tokenBudget  ?? 60_000;
    const maxToolLoops = opt.maxToolLoops ?? 5;
    const emit         = opt.onProgress ?? (() => {});

    const result: AgentResult = {
      task,
      complexity:   'simple',
      steps:        [],
      filesWritten: [],
      commits:      [],
      backupBranch: '',
      totalTokens:  0,
      totalCost:    0,
      durationMs:   0,
    };

    // ── 1. Project analysis ─────────────────────────────────────────────
    emit({ type: 'status', message: 'Analyzing project structure…' });
    let contextString = '';

    try {
      const analysis    = this.analyzer.analyze(outputDir);
      this.ctxBuilder   = new ContextBuilderService(analysis);
      const ctx         = this.ctxBuilder.build(task, tokenBudget);
      contextString     = ctx.contextString;
      emit({ type: 'status', message: `Context: ${ctx.files.length} files selected (~${ctx.totalTokens.toLocaleString()} tokens)` });
    } catch (e: any) {
      emit({ type: 'error', message: `Analysis fallback: ${e.message}` });
    }

    // ── 2. Complexity assessment ────────────────────────────────────────
    const complexity   = this.taskAnalyzer.assessComplexity(task);
    result.complexity  = complexity.level;
    emit({ type: 'status', message: `Complexity: ${complexity.level} (score ${complexity.score})` });

    // ── 3. Git backup ───────────────────────────────────────────────────
    if (await this.git.isGitRepo()) {
      try {
        await this.git.configureUser();
        const backup        = await this.git.createBackupBranch(task);
        result.backupBranch = backup.backupBranch;
        if (result.backupBranch) {
          emit({ type: 'status', message: `Backup branch: ${result.backupBranch}` });
        }
      } catch { /* non-fatal */ }
    }

    // ── 4. Execute ──────────────────────────────────────────────────────
    if (!opt.skipDecompose && complexity.level === 'complex') {
      // ── 4b. Complex: decompose → sequential steps ──────────────────
      await this.executeDecomposed(task, contextString, opt, result, emit, maxToolLoops);
    } else {
      // ── 4a. Simple/Medium: single ReAct loop ───────────────────────
      const step = await this.executeWithTools(task, contextString, null, [], opt, emit, maxToolLoops);
      await this.applyStep(step, result, outputDir, null, emit);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  // ─── Decomposed execution ───────────────────────────────────────────────

  private async executeDecomposed(
    task:         string,
    contextString: string,
    opt:          AgentOptions,
    result:       AgentResult,
    emit:         (ev: AgentEvent) => void,
    maxToolLoops: number,
  ): Promise<void> {

    emit({ type: 'status', message: 'Decomposing task into subtasks…' });

    // Get subtasks from LLM
    let subtasks: SubTask[] = [];
    try {
      const decompPrompt   = this.taskAnalyzer.buildDecompositionPrompt(task, contextString);
      const decompResponse = await this.llm.complete(
        'Decompose this task into ordered subtasks as JSON.',
        decompPrompt,
      );
      subtasks = this.taskAnalyzer.parseDecomposition(decompResponse.content, task)
              ?? this.taskAnalyzer.heuristicDecompose(task);
    } catch {
      subtasks = this.taskAnalyzer.heuristicDecompose(task);
    }

    emit({ type: 'status', message: `Plan: ${subtasks.map(s => s.title).join(' → ')}` });

    // Execute each subtask in order
    const previousResults: SubTaskResult[] = [];

    for (const subtask of subtasks) {
      emit({ type: 'step_start', message: `Step ${subtask.id}/${subtasks.length}: ${subtask.title}`, data: { subtask } });

      // Build subtask prompt (inject previous step results)
      const subtaskContext = this.taskAnalyzer.buildSubtaskPrompt(
        subtask, subtasks, previousResults, contextString,
      );

      const step = await this.executeWithTools(
        subtask.description, subtaskContext, subtask, previousResults, opt, emit, maxToolLoops,
      );

      await this.applyStep(step, result, resolve(opt.outputDir), subtask, emit);

      previousResults.push({
        subtask,
        files:   step.files,
        summary: step.files.length ? `wrote ${step.files.length} file(s)` : 'no files',
        response: step.response,
        skipped: step.skipped,
      });

      emit({ type: 'step_done', message: `Step ${subtask.id} complete`, data: { files: step.files } });
    }
  }

  // ─── ReAct loop (Tool-use) ──────────────────────────────────────────────

  /**
   * Executes a task with a ReAct loop:
   *   LLM response → parse tool calls → execute → inject results → repeat
   * Terminates when the LLM produces a response with no tool calls.
   */
  private async executeWithTools(
    task:            string,
    contextString:   string,
    subtask:         SubTask | null,
    previousResults: SubTaskResult[],
    opt:             AgentOptions,
    emit:            (ev: AgentEvent) => void,
    maxLoops:        number,
  ): Promise<StepResult> {

    const step: StepResult = {
      subtask, files: [], commits: [], tokens: 0, cost: 0,
      toolCalls: [], response: '', skipped: false,
    };

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(contextString);

    // Conversation messages for this execution
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system',  content: systemPrompt },
      { role: 'user',    content: task },
    ];

    let loops = 0;

    while (loops < maxLoops) {
      loops++;
      emit({ type: 'status', message: loops === 1 ? 'Generating…' : `Tool loop ${loops}/${maxLoops}…` });

      const res = await this.llm.completeWithHistory(messages, undefined, ToolsService.getNativeTools(false));
      step.tokens += res.tokensUsed.total;
      step.cost   += res.cost.total;

      const toolCalls = res.toolCalls || [];

      if (!toolCalls.length) {
        // Final answer — no more tool calls
        step.response = res.content;
        messages.push({ role: 'assistant', content: res.content });
        break;
      }

      // Execute each tool call
      messages.push({ role: 'assistant', content: res.content || 'Executing tools...' });
      const resultParts: string[] = [];

      for (const call of toolCalls) {
        emit({
          type: 'tool_call',
          message: `→ ${call.name}(${JSON.stringify(call.args)})`,
        });
        const toolResult = await this.tools.execute(call as any);
        step.toolCalls.push(toolResult);

        const formatted = ToolsService.formatToolResult(toolResult);
        resultParts.push(formatted);

        emit({
          type: 'tool_result',
          message: `← ${call.name}: ${(toolResult.output || toolResult.error || '').slice(0, 80)}…`,
        });
      }

      // Inject tool results as a user turn
      messages.push({
        role: 'user',
        content: resultParts.join('\n\n') + '\n\nContinue with your implementation.',
      });
    }

    // Parse code blocks from the final response
    step.files = await this.parseAndWriteBlocks(step.response, resolve(opt.outputDir), emit);

    return step;
  }

  // ─── Apply step results (write files + git commit) ──────────────────────

  private async applyStep(
    step:      StepResult,
    result:    AgentResult,
    outputDir: string,
    subtask:   SubTask | null,
    emit:      (ev: AgentEvent) => void,
  ): Promise<void> {

    result.steps.push(step);
    result.totalTokens += step.tokens;
    result.totalCost   += step.cost;
    result.filesWritten.push(...step.files);

    // Git commit for this step
    if (step.files.length) {
      await this.commitStep(step.files, subtask?.title ?? 'AI changes', result, emit);
    }
  }

  private async commitStep(
    files:   string[],
    title:   string,
    result:  AgentResult,
    emit:    (ev: AgentEvent) => void,
  ): Promise<void> {
    const isRepo = await this.git.isGitRepo();
    if (!isRepo) return;
    try {
      await this.git.stageFiles(files);
      const msg    = `feat: ${title}`;
      const commit = await this.git.commit(msg);
      result.commits.push(commit.hash);
      emit({ type: 'git_commit', message: `${commit.hash} ${msg}` });
    } catch { /* non-fatal */ }
  }

  // ─── Code block parser + file writer ────────────────────────────────────

  private async parseAndWriteBlocks(
    response:  string,
    outputDir: string,
    emit:      (ev: AgentEvent) => void,
  ): Promise<string[]> {

    const written: string[] = [];
    const BLOCK_RE = /```(?:[\w-]+)?:([^\n]+)\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;

    const isSafeRelPath = (p: string): boolean => {
      if (!p) return false;
      const norm = normalize(p).replace(/\\/g, '/');
      if (isAbsolute(norm)) return false;
      if (/^[A-Za-z]:\//.test(norm)) return false;
      if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) return false;
      return true;
    };

    while ((m = BLOCK_RE.exec(response)) !== null) {
      const filename = m[1].trim();
      const content  = m[2];
      if (!filename || !content.trim()) continue;

      if (!isSafeRelPath(filename)) {
        emit({ type: 'error', message: `Blocked unsafe write path: ${filename}` });
        continue;
      }

      const fp = resolve(outputDir, filename);
      const relToOut = relative(outputDir, fp).replace(/\\/g, '/');
      if (relToOut.startsWith('..')) {
        emit({ type: 'error', message: `Blocked write outside outputDir: ${filename}` });
        continue;
      }

      const toolResult = await this.tools.execute({
        name: 'write_file',
        args: { path: relToOut, content },
      });

      if (toolResult.error) {
        emit({ type: 'error', message: `Failed to write ${filename}: ${toolResult.error}` });
        continue;
      }

      written.push(relToOut);
      emit({ type: 'file_written', message: `✅ ${filename}`, data: { path: fp } });
    }

    return written;
  }

  // ─── System prompt builder ───────────────────────────────────────────────

  private buildSystemPrompt(contextString: string): string {
    const localInstructions = ToolsService.readLocalInstructions(resolve('.'), resolve('.'));
    const projectContext = ToolsService.readProjectContext(resolve('.'));

    return ToolsService.toolsSystemSection(projectContext, false, localInstructions) + `\n\n${contextString}`;
  }

  // ─── Static report formatter ─────────────────────────────────────────────

  static formatResult(result: AgentResult): string {
    const bar    = '═'.repeat(54);
    const lines  = [`\n${bar}`, `📊  Agent Result`, bar, ''];

    lines.push(`  Complexity   : ${result.complexity}`);
    lines.push(`  Steps done   : ${result.steps.filter(s => !s.skipped).length}/${result.steps.length}`);
    lines.push(`  Files written: ${result.filesWritten.length}`);
    lines.push(`  Commits      : ${result.commits.length}`);
    lines.push(`  Total tokens : ${result.totalTokens.toLocaleString()}`);
    lines.push(`  Total cost   : $${result.totalCost.toFixed(6)}`);
    lines.push(`  Duration     : ${(result.durationMs / 1000).toFixed(1)}s`);

    if (result.backupBranch) {
      lines.push(`  Backup branch: ${result.backupBranch}`);
      lines.push(`  To rollback  : git reset --hard ${result.backupBranch}`);
    }

    if (result.filesWritten.length) {
      lines.push('\n  Files:');
      result.filesWritten.forEach(f => lines.push(`    ✅ ${f}`));
    }

    if (result.commits.length) {
      lines.push('\n  Commits:');
      result.commits.forEach(c => lines.push(`    📦 ${c}`));
    }

    if (result.steps.some(s => s.toolCalls.length)) {
      const totalTools = result.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      lines.push(`\n  Tool calls used: ${totalTools}`);
    }

    lines.push(`\n  Continue: node bin/dev.js code "follow-up task"`);
    lines.push(`  Git log : git log --all --oneline`);
    lines.push('');

    return lines.join('\n');
  }
}
