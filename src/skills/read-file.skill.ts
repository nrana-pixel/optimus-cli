import { Skill, SkillContext } from './base-skill.js';
import { resolve, relative } from 'path';
import { existsSync, statSync, readFileSync } from 'fs';
import { truncateMiddle } from '../utils/truncate.js';

export class ReadFileSkill implements Skill {
  name = 'read_file';
  description = 'Read the contents of a file. Preserves head and tail for large files.';
  schema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' }
    },
    required: ['path']
  };

  async execute(args: { path: string }, context: SkillContext): Promise<string> {
    const abs = resolve(context.workingDir, args.path);
    if (!existsSync(abs)) return `File not found: ${args.path}`;

    const st = statSync(abs);
    if (st.isDirectory()) return `${args.path} is a directory — use list_dir instead`;

    const content = readFileSync(abs, 'utf-8');
    const MAX_FILE_BYTES = 200_000;

    if (st.size > MAX_FILE_BYTES || content.split('\n').length > 1000) {
      return truncateMiddle(content, {
        maxChars: MAX_FILE_BYTES,
        maxLines: 1000,
        preserveHeadLines: 100,
        preserveTailLines: 100
      });
    }

    return content;
  }
}
