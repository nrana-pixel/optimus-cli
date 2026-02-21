/**
 * Task Analyzer Service
 * Evaluates task complexity, decomposes complex tasks into ordered
 * subtasks, and provides execution context for each step.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export interface TaskComplexity {
  level:   ComplexityLevel;
  score:   number;       // 0–100
  reasons: string[];
}

export interface SubTask {
  id:          number;
  title:       string;
  description: string;
  hint?:       string;   // suggested files/approach
  dependsOn:   number[]; // IDs of subtasks this depends on
}

export interface TaskDecomposition {
  originalTask: string;
  complexity:   TaskComplexity;
  subtasks:     SubTask[];
}

export interface SubTaskResult {
  subtask:  SubTask;
  files:    string[];   // files generated
  summary:  string;     // one-line summary of what was done
  response: string;     // full LLM response
  skipped:  boolean;
}

// ─── Complexity heuristics ────────────────────────────────────────────────

/** Keywords that signal a complex, multi-part task */
const COMPLEX_SIGNALS = [
  'complete', 'full', 'entire', 'whole', 'comprehensive', 'production',
  'system', 'implement', 'build', 'create', 'develop', 'setup', 'scaffold',
  'authentication', 'authorization', 'dashboard', 'payment', 'billing',
  'notification', 'real-time', 'realtime', 'websocket', 'upload', 'search',
  'admin', 'management', 'platform', 'microservice', 'integration',
];

/** Keywords that signal a simple single-file task */
const SIMPLE_SIGNALS = [
  'fix', 'rename', 'add field', 'add column', 'update', 'change',
  'typo', 'comment', 'log', 'export', 'import', 'type', 'interface',
];

/** Patterns that add complexity (connectives suggest multiple steps) */
const CONNECTIVE_PATTERN = /\band\b|\bthen\b|\balso\b|\bplus\b/gi;

// ─── TaskAnalyzerService ──────────────────────────────────────────────────

export class TaskAnalyzerService {

  // ─── Complexity assessment ──────────────────────────────────────────────

  assessComplexity(task: string): TaskComplexity {
    const lower   = task.toLowerCase();
    const words   = lower.split(/\s+/).length;
    const reasons: string[] = [];
    let score = 0;

    // 1. Word count
    if (words > 15) { score += 20; reasons.push(`long description (${words} words)`); }
    else if (words > 8) { score += 8; reasons.push(`medium description`); }

    // 2. Complex keyword matches
    const complexHits = COMPLEX_SIGNALS.filter(s => lower.includes(s));
    if (complexHits.length >= 3) {
      score += 35;
      reasons.push(`complex keywords: ${complexHits.slice(0, 3).join(', ')}`);
    } else if (complexHits.length >= 1) {
      score += complexHits.length * 12;
      reasons.push(`keywords: ${complexHits.join(', ')}`);
    }

    // 3. Simple signal (reduces score)
    const simpleHits = SIMPLE_SIGNALS.filter(s => lower.includes(s));
    if (simpleHits.length) {
      score -= simpleHits.length * 10;
      reasons.push(`simple signals: ${simpleHits.join(', ')}`);
    }

    // 4. Connectives ("and", "then", "also") imply multiple steps
    const connectives = lower.match(CONNECTIVE_PATTERN) ?? [];
    if (connectives.length >= 2) {
      score += 15;
      reasons.push(`${connectives.length} connective conjunctions`);
    } else if (connectives.length === 1) {
      score += 6;
    }

    // 5. Multiple nouns in task (heuristic: commas)
    const commas = (task.match(/,/g) ?? []).length;
    if (commas >= 2) { score += 15; reasons.push(`list of items (${commas} commas)`); }

    const clampedScore = Math.max(0, Math.min(100, score));
    const level: ComplexityLevel =
      clampedScore >= 40 ? 'complex' :
      clampedScore >= 18 ? 'medium'  : 'simple';

    return { level, score: clampedScore, reasons };
  }

  // ─── Decomposition prompt ────────────────────────────────────────────────

  buildDecompositionPrompt(task: string, projectContext?: string): string {
    return `You are a senior software architect. Your job is to decompose a development task into ordered atomic subtasks.

TASK: "${task}"
${projectContext ? `\nPROJECT CONTEXT (existing files):\n${projectContext}` : ''}

Rules:
- Decompose into 3–7 subtasks maximum
- Each subtask must be a single, concrete implementation step
- Order them by dependency (foundational work first)
- Each subtask should take 1 LLM call to implement
- Be specific about what to build, not generic

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "subtasks": [
    {
      "id": 1,
      "title": "Short title",
      "description": "Exactly what to implement in this step",
      "hint": "Expected files: e.g. src/models/user.ts",
      "dependsOn": []
    },
    {
      "id": 2,
      "title": "...",
      "description": "...",
      "hint": "...",
      "dependsOn": [1]
    }
  ]
}`;
  }

  // ─── Parse LLM decomposition response ────────────────────────────────────

  parseDecomposition(raw: string, originalTask: string): SubTask[] | null {
    try {
      // Extract JSON from response (handle wrapped markdown)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.subtasks)) return null;

      return parsed.subtasks.map((s: any, i: number) => ({
        id:          Number(s.id ?? i + 1),
        title:       String(s.title ?? `Step ${i + 1}`),
        description: String(s.description ?? ''),
        hint:        s.hint ? String(s.hint) : undefined,
        dependsOn:   Array.isArray(s.dependsOn) ? s.dependsOn.map(Number) : [],
      }));
    } catch {
      return null;
    }
  }

  // ─── Subtask execution prompt ─────────────────────────────────────────────

  /**
   * Build the prompt for executing a single subtask, injecting
   * previous results as context so the LLM knows what was already built.
   */
  buildSubtaskPrompt(
    subtask:         SubTask,
    allSubtasks:     SubTask[],
    previousResults: SubTaskResult[],
    projectContext:  string,
  ): string {
    const total        = allSubtasks.length;
    const prevSummary  = previousResults
      .filter(r => !r.skipped)
      .map(r => `  Step ${r.subtask.id}: ${r.subtask.title} → ${r.summary} (files: ${r.files.join(', ') || 'none'})`)
      .join('\n');

    const remaining = allSubtasks
      .filter(s => s.id > subtask.id)
      .map(s => `  Step ${s.id}: ${s.title}`)
      .join('\n');

    return `You are implementing step ${subtask.id} of ${total} for the following project.

OVERALL GOAL: ${allSubtasks[0] ? `Part of: ${allSubtasks.map(s => s.title).join(' → ')}` : ''}

CURRENT STEP (${subtask.id}/${total}): ${subtask.title}
DESCRIPTION: ${subtask.description}
${subtask.hint ? `HINT: ${subtask.hint}` : ''}

${prevSummary ? `ALREADY COMPLETED:\n${prevSummary}\n` : ''}
${remaining ? `UPCOMING STEPS (do NOT implement these yet):\n${remaining}\n` : ''}

${projectContext}

RULES:
1. Implement ONLY the current step — do not implement upcoming steps
2. Your code must integrate with any files already created (listed above)
3. Wrap every file in: \`\`\`language:path/to/file.ext
4. Return complete file contents, not diffs
5. Add clear comments explaining the implementation`;
  }

  // ─── Fallback decomposition (no LLM needed) ──────────────────────────────

  /**
   * Simple rule-based decomposition as fallback when the LLM
   * decomposition call fails or is skipped.
   */
  heuristicDecompose(task: string): SubTask[] {
    const lower = task.toLowerCase();
    const subtasks: SubTask[] = [];
    let id = 1;

    // Auth system
    if (lower.includes('auth')) {
      subtasks.push(
        { id: id++, title: 'User model', description: 'Create user data model/schema with email, password, role fields', hint: 'src/models/user.ts', dependsOn: [] },
        { id: id++, title: 'Auth service', description: 'Implement authentication logic: register, login, JWT sign/verify, password hashing', hint: 'src/services/auth.service.ts', dependsOn: [1] },
        { id: id++, title: 'Auth middleware', description: 'Create middleware to protect routes by verifying JWT tokens', hint: 'src/middleware/auth.middleware.ts', dependsOn: [2] },
        { id: id++, title: 'Auth routes', description: 'Add POST /auth/register and POST /auth/login route handlers', hint: 'src/routes/auth.routes.ts', dependsOn: [2] },
      );
    }
    // Generic CRUD
    else if (lower.includes('crud') || lower.includes('api')) {
      subtasks.push(
        { id: id++, title: 'Data model', description: 'Create the data model/schema for the resource', hint: 'src/models/', dependsOn: [] },
        { id: id++, title: 'Service layer', description: 'Implement business logic: create, read, update, delete operations', hint: 'src/services/', dependsOn: [1] },
        { id: id++, title: 'API routes', description: 'Add REST endpoints: GET, POST, PUT, DELETE', hint: 'src/routes/', dependsOn: [2] },
      );
    }
    // General complex task
    else {
      const parts = task.split(/\band\b|\bthen\b/i).map(s => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        parts.forEach((part, i) => subtasks.push({
          id: id++,
          title: `Step ${i + 1}`,
          description: part,
          dependsOn: i === 0 ? [] : [i],
        }));
      } else {
        // Can't decompose — single subtask
        subtasks.push({ id: 1, title: task.slice(0, 50), description: task, dependsOn: [] });
      }
    }

    return subtasks;
  }
}
