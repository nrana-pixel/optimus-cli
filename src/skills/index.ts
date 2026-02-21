import { Skill, SkillRegistry } from './base-skill.js';
import { ReadFileSkill } from './read-file.skill.js';
import { WriteFileSkill } from './write-file.skill.js';
import { ApplyPatchSkill } from './apply-patch.skill.js';
import { ListDirSkill } from './list-dir.skill.js';
import { RunCommandSkill, WriteStdinSkill } from './shell.skill.js';
import { UnifiedExecService } from '../services/unified-exec.service.js';

/**
 * Global registry for Optimus Skills.
 */
export const registry = new SkillRegistry();

const unifiedExec = new UnifiedExecService();

// Register built-in skills
registry.register(new ReadFileSkill());
registry.register(new WriteFileSkill());
registry.register(new ApplyPatchSkill());
registry.register(new ListDirSkill());
registry.register(new RunCommandSkill(unifiedExec));
registry.register(new WriteStdinSkill(unifiedExec));

export * from './base-skill.js';
export * from './read-file.skill.js';
export * from './write-file.skill.js';
export * from './apply-patch.skill.js';
export * from './list-dir.skill.js';
export * from './shell.skill.js';
