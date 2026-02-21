import { Command, Flags } from '@oclif/core';
import { PilotService, PilotSuggestion } from '../services/pilot.service.js';
import prompts from 'prompts';
import { resolve } from 'path';

// ─── ANSI / terminal helpers (consistent with chat.ts) ─────────────────────────

const o = (s: string) => process.stdout.write(s);

const A = {
  r:   '\x1b[0m',
  b:   '\x1b[1m',
  d:   '\x1b[2m',
  i:   '\x1b[3m',
  cy:  '\x1b[36m',
  gr:  '\x1b[32m',
  ye:  '\x1b[33m',
  re:  '\x1b[31m',
  gy:  '\x1b[90m',
  wh:  '\x1b[97m',
  mg:  '\x1b[35m',
  bl:  '\x1b[34m',
  cl:  '\x1b[2K',
  up:  (n: number) => `\x1b[${n}A`,
};

const p = (col: string, s: string) => `${col}${s}${A.r}`;

export default class Pilot extends Command {
  static description = 'Code-with-me mode — Optimus Pilot';

  static flags = {
    debounce: Flags.integer({ char: 'd', description: 'Debounce time in ms', default: 3000 }),
    budget: Flags.integer({ char: 'b', description: 'Token budget for context', default: 30000 }),
  };

  private pilot = new PilotService();

  async run() {
    const { flags } = await this.parse(Pilot);
    const workingDir = resolve('.');

    this._banner();

    // 1. Ask for AIM
    const response = await prompts({
      type: 'text',
      name: 'aim',
      message: 'What is your aim for this session?',
      initial: 'Refactoring code and improving quality',
    });

    if (!response.aim) {
      this.log(p(A.re, 'Aim is required to start Pilot mode.'));
      return;
    }

    // 2. Start Pilot
    o('\n');
    this.pilot.start({
      workingDir,
      aim: response.aim,
      debounceMs: flags.debounce,
      tokenBudget: flags.budget,
      onStatus: (status) => {
        o(`\n${A.cl}${p(A.gy, '  [Pilot] ')}${status}`);
      },
      onSuggestion: (s) => {
        this._displaySuggestion(s);
      },
    });

    // Handle exit
    process.on('SIGINT', () => {
      this.pilot.stop();
      o('\n' + p(A.ye + A.b, '  Pilot mode stopped. Goodbye! 👋\n\n'));
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }

  private _displaySuggestion(s: PilotSuggestion) {
    const W = 60;
    const HR = '─'.repeat(W);
    o('\n\n');
    o(p(A.mg + A.b, `  ┌${HR}┐\n`));
    o(p(A.mg + A.b, '  │') + p(A.b + A.wh, '  💡 Optimus Pilot Suggestion') + p(A.gy, ' '.repeat(W - 28)) + p(A.mg + A.b, '│\n'));
    o(p(A.mg + A.b, `  ├${HR}┤\n`));
    o(p(A.mg + A.b, '  │') + p(A.cy + A.b, `  File: ${s.filePath}`) + p(A.gy, ' '.repeat(W - s.filePath.length - 8)) + p(A.mg + A.b, '│\n'));
    o(p(A.mg + A.b, `  ├${HR}┤\n`));

    // Wrap suggestion text
    const words = s.suggestion.split(' ');
    let line = '';
    for (const word of words) {
      if ((line + word).length > W - 6) {
        o(p(A.mg + A.b, '  │') + p(A.wh, `  ${line.padEnd(W - 4)}`) + p(A.mg + A.b, '│\n'));
        line = '';
      }
      line += word + ' ';
    }
    if (line) {
      o(p(A.mg + A.b, '  │') + p(A.wh, `  ${line.padEnd(W - 4)}`) + p(A.mg + A.b, '│\n'));
    }

    o(p(A.mg + A.b, `  ├${HR}┤\n`));
    const stats = `${s.tokensUsed} tokens | $${s.cost.toFixed(5)}`;
    o(p(A.mg + A.b, '  │') + p(A.gy, `  ${stats.padEnd(W - 4)}`) + p(A.mg + A.b, '│\n'));
    o(p(A.mg + A.b, `  └${HR}┘\n\n`));
    o(p(A.gy, '  Watching for changes...'));
  }

  private _banner() {
    o('\n');
    o(p(A.mg + A.b, '  ╭──────────────────────────────────────────────────────────╮\n'));
    o(p(A.mg + A.b, '  │') + p(A.wh + A.b, '  🚀 OPTIMUS PILOT MODE') + p(A.gy, ' — Proactive Pair Programming  ') + p(A.mg + A.b, '│\n'));
    o(p(A.mg + A.b, '  ╰──────────────────────────────────────────────────────────╯\n'));
    o(p(A.gy, '    Pilot watches your files and suggests improvements as you code.\n'));
    o(p(A.gy, '    Press Ctrl+C to exit.\n\n'));
  }
}
