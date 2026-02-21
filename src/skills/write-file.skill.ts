import { Skill, SkillContext } from './base-skill.js';
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

export class WriteFileSkill implements Skill {
  name = 'write_file';
  description = 'Create or overwrite a file with new content. Use this for NEW files or complete rewrites.';
  schema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to write' },
      content: { type: 'string', description: 'File content' }
    },
    required: ['path', 'content']
  };

  async execute(args: { path: string, content: string }, context: SkillContext): Promise<string> {
    const abs = resolve(context.workingDir, args.path);
    const dir = dirname(abs);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const isNew = !existsSync(abs);
    writeFileSync(abs, args.content, 'utf-8');

    return `${isNew ? 'Created' : 'Updated'}: ${args.path} (${args.content.split('\n').length} lines)`;
  }
}
