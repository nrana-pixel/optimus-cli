import { Skill, SkillContext } from './base-skill.js';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export class ApplyPatchSkill implements Skill {
  name = 'apply_patch';
  description = 'Resilient surgical edit using SEARCH/REPLACE blocks. Use this for reliable code modification.';
  schema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to edit' },
      patch: { type: 'string', description: 'One or more blocks in the format: <<<<<< SEARCH\n...\n======\n...\n>>>>>>' }
    },
    required: ['path', 'patch']
  };

  async execute(args: { path: string, patch: string }, context: SkillContext): Promise<string> {
    const abs = resolve(context.workingDir, args.path);
    if (!existsSync(abs)) return `File not found: ${args.path}`;

    const original = readFileSync(abs, 'utf-8');
    const blocks = args.patch.split('<<<<<< SEARCH');
    if (blocks.length <= 1) return 'apply_patch failed: No SEARCH/REPLACE blocks found.';

    let currentContent = original;
    let appliedCount = 0;

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const parts = block.split('======');
      if (parts.length !== 2) continue;

      const searchPart = parts[0].trim();
      const replacePartWithEnd = parts[1];
      const replaceParts = replacePartWithEnd.split('>>>>>>');
      if (replaceParts.length < 2) continue;

      const replacePart = replaceParts[0].trim();

      if (currentContent.includes(searchPart)) {
        currentContent = currentContent.replace(searchPart, replacePart);
        appliedCount++;
      }
    }

    if (appliedCount > 0) {
      writeFileSync(abs, currentContent, 'utf-8');
      return `Applied ${appliedCount} patch block(s) to ${args.path}`;
    }

    return 'apply_patch failed: Could not find SEARCH blocks. Ensure they match exactly (including whitespace).';
  }
}
