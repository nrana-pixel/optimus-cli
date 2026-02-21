/**
 * Context Builder Service
 * Analyzes a task description, scores project files for relevance,
 * resolves local dependencies, and assembles a context string
 * that stays within a token budget.
 *
 * Prevents sending the entire codebase to the LLM.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { ProjectAnalysis, FileAnalysis } from './analyzer.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScoredFile {
  file:    FileAnalysis;
  score:   number;
  reasons: string[];      // human-readable reasons for the score
  tokens:  number;        // estimated token count of the file's content
  content: string;        // actual file content (empty if unreadable)
}

export interface BuiltContext {
  task:         string;
  keywords:     string[];
  files:        ScoredFile[];    // sorted by score desc, within token budget
  excluded:     ScoredFile[];    // scored but didn't fit in budget
  totalTokens:  number;
  tokenBudget:  number;
  contextString: string;         // ready to inject into LLM system prompt
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Characters per token (GPT/Gemini approximation) */
const CHARS_PER_TOKEN = 4;

/** Language priority for code tasks (higher = more relevant by default) */
const LANG_PRIORITY: Record<string, number> = {
  TypeScript:  4,
  JavaScript:  3,
  Python:      3,
  Go:          3,
  Rust:        3,
  Java:        2,
  'C#':        2,
  CSS:         1,
  SCSS:        1,
  HTML:        1,
  JSON:        1,
  YAML:        0,
  Markdown:    0,
  Env:         0,
};

/** Common abbreviation expansions */
const EXPANSIONS: Record<string, string[]> = {
  auth:    ['auth', 'authentication', 'authorize', 'login', 'token', 'jwt', 'session'],
  user:    ['user', 'profile', 'account', 'member', 'person'],
  db:      ['db', 'database', 'mongo', 'postgres', 'mysql', 'prisma', 'orm', 'model'],
  api:     ['api', 'route', 'endpoint', 'controller', 'handler', 'rest'],
  ui:      ['ui', 'view', 'component', 'page', 'screen', 'layout'],
  config:  ['config', 'setting', 'env', 'option'],
  test:    ['test', 'spec', 'unit', 'integration', 'e2e'],
  pay:     ['pay', 'payment', 'billing', 'stripe', 'invoice', 'subscription'],
  email:   ['email', 'mail', 'smtp', 'notification', 'mailer'],
  upload:  ['upload', 'file', 'storage', 'bucket', 's3', 'blob'],
  cache:   ['cache', 'redis', 'memcache', 'ttl'],
  log:     ['log', 'logger', 'logging', 'monitor', 'trace'],
};

// ─── ContextBuilderService ────────────────────────────────────────────────

export class ContextBuilderService {
  constructor(private analysis: ProjectAnalysis) {}

  /**
   * Build a context for the given task within the token budget.
   * @param task       The user's task description
   * @param tokenBudget  Max tokens to use for context (default 80K)
   */
  build(task: string, tokenBudget = 80_000): BuiltContext {
    const keywords = this.extractKeywords(task);

    // Score every file
    const scored = this.analysis.files
      .map(f => this.scoreFile(f, keywords, task))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Pick top files within budget, then augment with dependencies
    const selected  = this.fillBudget(scored, tokenBudget * 0.85); // leave 15% headroom
    const withDeps  = this.resolveDependencies(selected, scored, tokenBudget);
    const excluded  = scored.filter(s => !withDeps.find(w => w.file.path === s.file.path));

    const totalTokens = withDeps.reduce((sum, s) => sum + s.tokens, 0);

    return {
      task,
      keywords,
      files:         withDeps,
      excluded,
      totalTokens,
      tokenBudget,
      contextString: this.buildContextString(task, keywords, withDeps),
    };
  }

  // ─── Keyword extraction ─────────────────────────────────────────────────

  extractKeywords(task: string): string[] {
    const raw = task
      .toLowerCase()
      // split camelCase: "authService" → "auth service"
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // split on non-alphanumeric
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2);

    // Remove common stopwords
    const stopwords = new Set([
      'the', 'and', 'for', 'with', 'add', 'new', 'create', 'update', 'delete',
      'remove', 'change', 'implement', 'make', 'that', 'this', 'from',
      'into', 'should', 'will', 'can', 'fix', 'build', 'get', 'set',
    ]);

    const filtered = raw.filter(w => !stopwords.has(w));

    // Expand known abbreviations
    const expanded = new Set<string>(filtered);
    for (const kw of filtered) {
      for (const [abbr, synonyms] of Object.entries(EXPANSIONS)) {
        if (kw === abbr || synonyms.includes(kw)) {
          synonyms.forEach(s => expanded.add(s));
          break;
        }
      }
    }

    return [...expanded];
  }

  // ─── File scoring ────────────────────────────────────────────────────────

  private scoreFile(file: FileAnalysis, keywords: string[], task: string): ScoredFile {
    const reasons: string[] = [];
    let score = 0;
    const pathLower = file.path.toLowerCase();
    const nameLower = file.name.toLowerCase().replace(/\.[^.]+$/, '');

    // 1. Explicit filename mention in task (highest weight)
    if (task.toLowerCase().includes(file.name.toLowerCase())) {
      score += 30;
      reasons.push(`explicitly mentioned in task (+30)`);
    }

    // 2. Path / name keyword match
    for (const kw of keywords) {
      if (nameLower === kw) {
        score += 12;
        reasons.push(`filename exact match "${kw}" (+12)`);
      } else if (nameLower.includes(kw)) {
        score += 6;
        reasons.push(`filename contains "${kw}" (+6)`);
      } else if (pathLower.includes(kw)) {
        score += 3;
        reasons.push(`path contains "${kw}" (+3)`);
      }
    }

    // 3. Export name match
    for (const kw of keywords) {
      const matchedExports = file.exports.filter(e =>
        e.toLowerCase().includes(kw)
      );
      if (matchedExports.length) {
        score += matchedExports.length * 5;
        reasons.push(`exports match "${kw}" [${matchedExports.join(', ')}] (+${matchedExports.length * 5})`);
      }
    }

    // 4. Import match
    for (const kw of keywords) {
      const matchedImports = file.imports.filter(i =>
        i.toLowerCase().includes(kw)
      );
      if (matchedImports.length) {
        score += matchedImports.length * 3;
        reasons.push(`imports contain "${kw}" (+${matchedImports.length * 3})`);
      }
    }

    // 5. Language priority bonus
    const langBonus = LANG_PRIORITY[file.language] ?? 0;
    if (langBonus > 0) {
      score += langBonus;
      reasons.push(`language priority +${langBonus}`);
    }

    // 6. Entry-point bonus
    if (/^(index|main|app|server|cli)\.[tj]sx?$/.test(file.name)) {
      score += 2;
      reasons.push(`entry-point bonus +2`);
    }

    // Read file content for token estimation
    let content = '';
    let tokens  = 0;
    if (score > 0) {
      content = this.readFile(join(this.analysis.root, file.path));
      tokens  = this.estimateTokens(content);
    }

    return { file, score, reasons, tokens, content };
  }

  // ─── Fill budget ────────────────────────────────────────────────────────

  private fillBudget(scored: ScoredFile[], budget: number): ScoredFile[] {
    const selected: ScoredFile[] = [];
    let used = 0;

    for (const s of scored) {
      if (used + s.tokens > budget) {
        // Try to include at least a truncated version for high scorers
        if (s.score >= 20 && selected.length < 3) {
          const truncated = this.truncateContent(s.content, budget - used);
          selected.push({ ...s, content: truncated, tokens: this.estimateTokens(truncated) });
          used += this.estimateTokens(truncated);
        }
        continue;
      }
      selected.push(s);
      used += s.tokens;
    }

    return selected;
  }

  // ─── Dependency resolution ───────────────────────────────────────────────

  /**
   * For each selected file, check its local imports.
   * If an imported file isn't already selected but is in the project, add it.
   */
  private resolveDependencies(
    selected: ScoredFile[],
    allScored: ScoredFile[],
    budget: number,
  ): ScoredFile[] {
    const result  = [...selected];
    const inSet   = new Set(selected.map(s => s.file.path));
    let used      = result.reduce((t, s) => t + s.tokens, 0);

    for (const s of selected) {
      const localImports = s.file.imports.filter(i => i.startsWith('.'));

      for (const imp of localImports) {
        // Resolve relative import to a path
        const resolved = this.resolveImport(s.file.path, imp);
        if (!resolved || inSet.has(resolved)) continue;

        // Look up in project files
        const depFile = this.analysis.files.find(f => f.path === resolved);
        if (!depFile) continue;

        // Check budget
        const depContent = this.readFile(join(this.analysis.root, depFile.path));
        const depTokens  = this.estimateTokens(depContent);

        if (used + depTokens <= budget) {
          const depScored: ScoredFile = {
            file:    depFile,
            score:   s.score * 0.6,  // dependency gets 60% of parent's score
            reasons: [`dependency of ${s.file.path}`],
            tokens:  depTokens,
            content: depContent,
          };
          result.push(depScored);
          inSet.add(resolved);
          used += depTokens;
        }
      }
    }

    // Re-sort by score
    return result.sort((a, b) => b.score - a.score);
  }

  // ─── Context string builder ──────────────────────────────────────────────

  private buildContextString(
    task: string,
    keywords: string[],
    files: ScoredFile[],
  ): string {
    if (!files.length) {
      return `## Project: ${this.analysis.name}\nNo relevant files found for task: "${task}"`;
    }

    const lines: string[] = [];

    lines.push(`## Smart Context — ${this.analysis.name}`);
    lines.push(`**Task:** ${task}`);
    lines.push(`**Keywords extracted:** ${keywords.join(', ')}`);
    lines.push(`**Files loaded:** ${files.length} of ${this.analysis.totalFiles} (most relevant only)`);
    lines.push(`**Tokens used:** ~${files.reduce((t, s) => t + s.tokens, 0).toLocaleString()}`);
    lines.push('');

    // Project structure overview (compact — just filenames+lang)
    lines.push('### Project file index (all files for reference)');
    lines.push('```');
    for (const f of this.analysis.files) {
      const included = files.find(s => s.file.path === f.path);
      const marker   = included ? '→' : ' ';
      lines.push(`${marker} ${f.path.padEnd(50)} ${f.language}`);
    }
    lines.push('```');
    lines.push('');

    // Full content of relevant files
    lines.push('### Relevant file contents');
    lines.push('');

    for (const s of files) {
      const ext   = s.file.ext.replace('.', '') || 'text';
      const badge = s.reasons.length
        ? `score: ${s.score} | ${s.reasons.slice(0, 2).join('; ')}`
        : `dependency`;

      lines.push(`#### ${s.file.path}`);
      
      const isLowRelevance = s.score < 20 && !s.reasons[0]?.includes('explicitly mentioned');
      
      if (isLowRelevance) {
        lines.push(`*${s.file.language} · ${s.file.lines} lines · ${badge} (SIGNATURES ONLY)*`);
        if (s.file.imports.length) {
          lines.push(`*Imports: ${s.file.imports.join(', ')}*`);
        }
        if (s.file.exports.length) {
          lines.push(`*Exports: ${s.file.exports.join(', ')}*`);
        }
        lines.push('*Full content omitted to save context space. Use read_file if you need to see the implementation details.*');
      } else {
        lines.push(`*${s.file.language} · ${s.file.lines} lines · ${badge}*`);
        if (s.file.imports.length) {
          lines.push(`*Imports: ${s.file.imports.join(', ')}*`);
        }
        if (s.file.exports.length) {
          lines.push(`*Exports: ${s.file.exports.join(', ')}*`);
        }
        lines.push('');
        lines.push('```' + ext);
        lines.push(s.content || '(empty or unreadable)');
        lines.push('```');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  private readFile(absPath: string): string {
    try {
      if (!existsSync(absPath)) return '';
      return readFileSync(absPath, 'utf-8');
    } catch {
      return '';
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private truncateContent(content: string, tokenBudget: number): string {
    const charBudget = tokenBudget * CHARS_PER_TOKEN;
    if (content.length <= charBudget) return content;
    const truncated = content.slice(0, charBudget);
    return truncated + '\n\n[... truncated to fit token budget ...]';
  }

  /**
   * Resolve a relative import path to a project-relative file path.
   * e.g. from "src/commands/code.ts", import "../services/git.service.js"
   *   → "src/services/git.service.ts"
   */
  private resolveImport(fromPath: string, importPath: string): string | null {
    const fromDir   = dirname(fromPath);
    const raw       = join(fromDir, importPath).replace(/\\/g, '/');
    const candidates = [
      raw,
      raw + '.ts',
      raw + '.tsx',
      raw + '.js',
      raw + '/index.ts',
      raw + '/index.js',
      // .js → .ts (TS ESM pattern)
      raw.replace(/\.js$/, '.ts'),
      raw.replace(/\.js$/, '.tsx'),
    ];

    for (const c of candidates) {
      if (this.analysis.files.find(f => f.path === c)) return c;
    }
    return null;
  }

  // ─── Static helpers ───────────────────────────────────────────────────────

  /** Format a context report for terminal display */
  static formatReport(ctx: BuiltContext): string {
    const lines: string[] = [];
    const pct = Math.round((ctx.totalTokens / ctx.tokenBudget) * 100);

    lines.push(`\n  📎 Context Builder Report`);
    lines.push(`  Keywords : ${ctx.keywords.slice(0, 8).join(', ')}`);
    lines.push(`  Selected : ${ctx.files.length} files  (~${ctx.totalTokens.toLocaleString()} tokens / ${pct}% of budget)`);
    lines.push(`  Excluded : ${ctx.excluded.length} files (not relevant or over budget)`);
    lines.push('');
    lines.push('  Files included (by relevance score):');
    ctx.files.forEach((s, i) => {
      const dep = s.reasons[0]?.startsWith('dependency') ? ' [dep]' : '';
      lines.push(`  ${String(i + 1).padStart(3)}. [${s.score.toString().padStart(3)}] ${s.file.path}${dep}`);
    });
    if (ctx.excluded.length > 0) {
      lines.push('');
      lines.push(`  Top excluded files:`);
      ctx.excluded.slice(0, 5).forEach(s => {
        lines.push(`       [${s.score.toString().padStart(3)}] ${s.file.path}  (${s.tokens} tok)`);
      });
    }

    return lines.join('\n');
  }
}
