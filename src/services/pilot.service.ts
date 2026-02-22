/**
 * Pilot Service — "Code-with-me" Mode
 * Watches files, tracks changes, and provides proactive AI suggestions.
 */

import { FSWatcher, watch } from 'chokidar';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';
import { LLMServiceLiteLLM } from './llm-litellm.service.js';
import { AnalyzerService } from './analyzer.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { globSync } from 'glob';

export interface PilotSuggestion {
  filePath: string;
  suggestion: string;
  tokensUsed: number;
  cost: number;
}

export interface PilotOptions {
  workingDir: string;
  aim: string;
  onSuggestion: (suggestion: PilotSuggestion) => void;
  onStatus: (status: string) => void;
  tokenBudget?: number;
  debounceMs?: number;
}

export class PilotService {
  private watcher: FSWatcher | null = null;
  private fileCache: Map<string, string> = new Map();
  private pendingChanges: Set<string> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  private llm: LLMServiceLiteLLM;
  private analyzer: AnalyzerService;

  constructor() {
    this.llm = new LLMServiceLiteLLM();
    this.analyzer = new AnalyzerService();
  }

  /**
   * Start the pilot session
   */
  public async start(opt: PilotOptions) {
    const { workingDir, aim, onSuggestion, onStatus } = opt;
    const debounceMs = opt.debounceMs ?? 3000; // 3 second debounce
    const tokenBudget = opt.tokenBudget ?? 30000;

    onStatus(`Pilot mode active. Aim: "${aim}"`);

    // Initialize file cache for diffing
    this.initializeCache(workingDir);

    this.watcher = watch(workingDir, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/pnpm-lock.yaml',
        '**/package-lock.json',
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (path: string) => {
      const relPath = relative(workingDir, path).replace(/\\/g, '/');
      this.pendingChanges.add(relPath);
      this.triggerSuggestion(opt, debounceMs, tokenBudget);
    });

    onStatus('Watching for changes...');
  }

  /**
   * Stop the pilot session
   */
  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.fileCache.clear();
    this.pendingChanges.clear();
  }

  private initializeCache(workingDir: string) {
    const files = globSync('**/*', {
      cwd: workingDir,
      ignore: [
        'node_modules/**',
        '.git/**',
        'dist/**',
        'build/**',
        '.next/**',
        'pnpm-lock.yaml',
        'package-lock.json',
      ],
      nodir: true,
    });

    for (const relPath of files) {
      const absPath = join(workingDir, relPath);
      try {
        const stats = statSync(absPath);
        if (stats.isFile()) {
          const content = readFileSync(absPath, 'utf-8');
          this.fileCache.set(relPath, content);
        }
      } catch (error) {
        // Ignore errors, e.g., permissions
      }
    }
  }

  private generateDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    let diff = '';

    // A very simple line-by-line diff. Can be replaced with a more robust diffing library.
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine !== newLine) {
        if (oldLine !== undefined) {
          diff += `- ${oldLine}\n`;
        }
        if (newLine !== undefined) {
          diff += `+ ${newLine}\n`;
        }
      } else if (oldLine !== undefined) {
        diff += `  ${oldLine}\n`;
      }
    }
    return diff;
  }

  private triggerSuggestion(opt: PilotOptions, debounceMs: number, tokenBudget: number) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(async () => {
      if (this.isProcessing) {
        // If already processing, try again in a bit to avoid losing pending changes
        this.triggerSuggestion(opt, debounceMs, tokenBudget);
        return;
      }

      if (this.pendingChanges.size === 0) return;

      this.isProcessing = true;

      const changes = Array.from(this.pendingChanges);
      this.pendingChanges.clear();

      try {
        opt.onStatus(`Analyzing changes in ${changes.length} file(s)...`);
        const suggestion = await this.generateSuggestion(opt.workingDir, opt.aim, changes, tokenBudget);
        if (suggestion) {
          opt.onSuggestion(suggestion);
        }
      } catch (error: any) {
        opt.onStatus(`Error: ${error.message}`);
      } finally {
        this.isProcessing = false;
        opt.onStatus('Watching for changes...');
      }
    }, debounceMs);
  }

  private async generateSuggestion(
    workingDir: string,
    aim: string,
    changedFiles: string[],
    tokenBudget: number
  ): Promise<PilotSuggestion | null> {
    // 1. Get project context
    const analysis = this.analyzer.analyze(workingDir);
    const ctxBuilder = new ContextBuilderService(analysis);
    const ctx = ctxBuilder.build(`Aim: ${aim}. Files changed: ${changedFiles.join(', ')}`, tokenBudget);

    // 2. Prepare the diff/content for changed files
    let changesContext = '### CURRENT CHANGES (DIFF FORMAT: - OLD, + NEW,   UNCHANGED)\n\n';
    for (const relPath of changedFiles) {
      const absPath = resolve(workingDir, relPath);
      if (!existsSync(absPath)) continue;

      const currentContent = readFileSync(absPath, 'utf-8');
      const previousContent = this.fileCache.get(relPath) || '';

      const diff = this.generateDiff(previousContent, currentContent);
      changesContext += `#### File: ${relPath}\n\`\`\`diff\n${diff}\`\`\`\n\n`;

      // Update cache
      this.fileCache.set(relPath, currentContent);
    }

    // 3. Prompt the LLM
    const systemPrompt = `
You are Optimus Pilot — a proactive pair-programmer.
The user is working toward an AIM. You are watching their file changes in real-time.

### YOUR JOB
1. Analyze the current changes relative to the AIM.
2. If the user is on the right track, offer the NEXT STEP or a small improvement.
3. If the user is making a mistake or deviating from the AIM, politely point it out.
4. Keep suggestions EXTREMELY concise and actionable.
5. If no immediate suggestion is needed, say "NO_SUGGESTION".

### DIFF FORMAT
The changes are provided in a diff format:
- Lines starting with '-' are removed lines.
- Lines starting with '+' are added lines.
- Lines starting with ' ' are unchanged lines.

### FORMAT
Return your response as:
---
[File Path]
[Your concise suggestion/critique/next-step]
---
`.trim();

    const userPrompt = `
AIM: ${aim}

${ctx.contextString}

${changesContext}

Provide a suggestion based on these changes.
`.trim();

    const res = await this.llm.complete(systemPrompt, userPrompt);

    if (res.content.includes('NO_SUGGESTION') || res.content.length < 10) {
      return null;
    }

    // Extract file path from "--- [Path] ..." format if present, otherwise use first changed file
    const match = res.content.match(/---\n(.*?)\n/);
    const filePath = match ? match[1].trim() : changedFiles[0];
    const suggestion = res.content.replace(/---/g, '').replace(filePath, '').trim();

    return {
      filePath,
      suggestion,
      tokensUsed: res.tokensUsed.total,
      cost: res.cost.total,
    };
  }
}
