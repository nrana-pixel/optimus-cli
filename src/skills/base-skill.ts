import { ToolResult } from '../services/tools.service.js';

/**
 * Base interface for all Optimus Skills.
 * Following the Codex pattern where tools are modular and self-contained.
 */
export interface Skill {
  name: string;
  description: string;
  schema: any; // JSON Schema for tool calling
  execute(args: any, context: SkillContext): Promise<string>;
}

export interface SkillContext {
  workingDir: string;
  // Expansion: add git, analyzer, etc. here if needed
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill) {
    this.skills.set(skill.name, skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  getNativeDefinitions(): any[] {
    return this.getAll().map(s => ({
      type: 'function',
      function: {
        name: s.name,
        description: s.description,
        parameters: s.schema
      }
    }));
  }
}
