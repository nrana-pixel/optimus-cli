import { Skill, SkillContext } from './base-skill.js';
import { resolve, relative, join } from 'path';
import { existsSync, statSync, readdirSync } from 'fs';

export class ListDirSkill implements Skill {
  name = 'list_dir';
  description = 'List the contents of a directory. Shows a tree-like structure.';
  schema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the directory to list' }
    },
    required: ['path']
  };

  async execute(args: { path: string }, context: SkillContext): Promise<string> {
    const abs = resolve(context.workingDir, args.path || '.');
    if (!existsSync(abs)) return `Directory not found: ${args.path}`;
    if (!statSync(abs).isDirectory()) return `${args.path} is a file — use read_file instead`;

    const IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage']);
    const lines: string[] = [`${args.path || '.'}/`];

    const walk = (dir: string, prefix: string, depth: number) => {
      if (depth > 4) return;
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => !IGNORE.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      entries.forEach((entry, i) => {
        const last      = i === entries.length - 1;
        const connector = last ? '└── ' : '├── ';
        const childPfx  = last ? '    ' : '│   ';
        const label     = entry.isDirectory() ? `📁 ${entry.name}/` : entry.name;
        lines.push(`${prefix}${connector}${label}`);
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), prefix + childPfx, depth + 1);
        }
      });
    };

    walk(abs, '', 0);
    return lines.join('\n');
  }
}
