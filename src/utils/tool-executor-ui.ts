import ora, { type Ora } from 'ora';
import chalk from 'chalk';

export class ToolExecutorUI {
  private spinner: Ora | null = null;
  private disabled = false;

  disable() {
    this.disabled = true;
  }

  start(label: string) {
    if (this.disabled) return;
    this.stop(true);
    this.spinner = ora({ text: label, spinner: 'dots' }).start();
  }

  succeed(label: string) {
    if (this.disabled) return;
    if (!this.spinner) {
      // fallback
      process.stdout.write(chalk.gray(`✔ ${label}\n`));
      return;
    }
    this.spinner.succeed(chalk.gray(label));
    this.spinner = null;
  }

  fail(label: string) {
    if (this.disabled) return;
    if (!this.spinner) {
      process.stdout.write(chalk.red(`✖ ${label}\n`));
      return;
    }
    this.spinner.fail(chalk.red(label));
    this.spinner = null;
  }

  info(msg: string) {
    if (this.disabled) return;
    // A transient info message (doesn't keep spinner)
    if (this.spinner) this.spinner.stop();
    process.stdout.write(chalk.gray(msg) + '\n');
    if (this.spinner) this.spinner.start();
  }

  stop(silent = false) {
    if (this.disabled) return;
    if (!this.spinner) return;
    if (silent) this.spinner.stop();
    else this.spinner.stop();
    this.spinner = null;
  }
}

export const toolExecutorUI = new ToolExecutorUI();
