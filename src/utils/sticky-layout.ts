import logUpdate from 'log-update';
import chalk from 'chalk';

export interface StickyHeaderState {
  model: string;
  tokens: number;
  cost: number;
  toolsEnabled: boolean;
  planMode: boolean;
  sessionName: string;
}

export class StickyLayout {
  private enabled = false;
  private lastHeader = '';

  enable() {
    // Only enable in interactive terminals.
    if (!process.stdout.isTTY) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    try {
      logUpdate.clear();
      logUpdate.done();
    } catch {
      // ignore
    }
  }

  renderHeader(state: StickyHeaderState) {
    if (!this.enabled) return;

    const tools = state.toolsEnabled ? chalk.greenBright('● tools') : chalk.gray('○ tools');
    const plan = state.planMode ? chalk.cyanBright('🔒 plan') : '';

    const line = [
      chalk.gray('Optimus'),
      chalk.gray('│'),
      chalk.whiteBright(state.model),
      chalk.gray('│'),
      chalk.white(`${state.tokens} tok`),
      chalk.gray('│'),
      chalk.white(`$${state.cost.toFixed(5)}`),
      chalk.gray('│'),
      tools,
      plan ? chalk.gray('│') : '',
      plan,
      chalk.gray('│'),
      chalk.gray(state.sessionName),
    ].filter(Boolean).join(' ');

    // Keep it stable so it doesn't flicker.
    this.lastHeader = line;
    logUpdate(this.lastHeader + '\n' + chalk.gray('─'.repeat(Math.min(process.stdout.columns || 80, 120))));
  }

  /** Print a normal line below the sticky header. */
  println(text: string) {
    if (!this.enabled) {
      process.stdout.write(text + '\n');
      return;
    }
    // Clear header, print, then re-render header
    logUpdate.clear();
    process.stdout.write(text + '\n');
    logUpdate(this.lastHeader + '\n' + chalk.gray('─'.repeat(Math.min(process.stdout.columns || 80, 120))));
  }
}

export const stickyLayout = new StickyLayout();
