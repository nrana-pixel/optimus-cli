import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';

export interface DiffStats {
  insertions: number;
  deletions: number;
}

export function renderUnifiedDiff(params: {
  filePath: string;
  before: string;
  after: string;
  context?: number;
}): { diffText: string; stats: DiffStats } {
  const { filePath, before, after, context = 3 } = params;

  const patch = createTwoFilesPatch(filePath, filePath, before, after, '', '', { context });

  let insertions = 0;
  let deletions = 0;

  const colored = patch
    .split('\n')
    .map((line: string) => {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
        return chalk.gray(line);
      }
      if (line.startsWith('+')) {
        insertions++;
        return chalk.green(line);
      }
      if (line.startsWith('-')) {
        deletions++;
        return chalk.red(line);
      }
      return line;
    })
    .join('\n');

  return { diffText: colored, stats: { insertions, deletions } };
}
