import { Skill, SkillContext } from './base-skill.js';
import { UnifiedExecService } from '../services/unified-exec.service.js';

export class RunCommandSkill implements Skill {
  name = 'run_command';
  description = 'Run a terminal command (e.g. pnpm install, node app.js). Supports interactive inputs via write_stdin if needed.';
  schema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' }
    },
    required: ['command']
  };

  constructor(private unifiedExec: UnifiedExecService) {}

  async execute(args: { command: string }, context: SkillContext): Promise<string> {
    return this.unifiedExec.spawn(args.command, [], context.workingDir);
  }
}

export class WriteStdinSkill implements Skill {
  name = 'write_stdin';
  description = 'Provide keyboard input to a process that is currently running.';
  schema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The process ID from a previous run_command result' },
      text: { type: 'string', description: 'The text to type into the process' }
    },
    required: ['id', 'text']
  };

  constructor(private unifiedExec: UnifiedExecService) {}

  async execute(args: { id: string, text: string }, context: SkillContext): Promise<string> {
    return this.unifiedExec.writeStdin(args.id, args.text);
  }
}
