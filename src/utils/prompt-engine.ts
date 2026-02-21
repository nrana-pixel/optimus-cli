import { input, editor } from '@inquirer/prompts';
import search from '@inquirer/search';

export interface PromptEngineReadOptions {
  /** When true, enable slash-command palette when user enters '/'. */
  enableCommandPalette?: boolean;
  /** When true, use editor prompt for multiline input. */
  multiline?: boolean;
  /** Prompt label */
  message?: string;
}

export interface CommandItem {
  name: string; // displayed label
  value: string; // actual command text
  description?: string;
}

/**
 * PromptEngine: inquirer-based, resilient input.
 *
 * - Single-line input uses @inquirer/prompts `input`
 * - Multiline uses `editor` (opens $EDITOR) which is the most reliable cross-platform
 * - Slash command palette uses @inquirer/search for fuzzy filtering
 */
export class PromptEngine {
  private history: string[] = [];

  constructor(private commands: CommandItem[] = []) {}

  setCommands(commands: CommandItem[]) {
    this.commands = commands;
  }

  getHistory(): string[] {
    return [...this.history];
  }

  async readLine(opts: PromptEngineReadOptions = {}): Promise<string> {
    const message = opts.message ?? '❯';

    // Multiline path: use editor prompt.
    if (opts.multiline) {
      const txt = await editor({
        message: `${message} (multiline)` ,
        waitForUseInput: false,
      });
      const v = (txt ?? '').trim();
      if (v) this.history.push(v);
      return v;
    }

    const txt = await input({ message });
    const v = (txt ?? '').trim();

    if (opts.enableCommandPalette && v === '/') {
      const chosen = await this.pickCommand();
      if (chosen) {
        this.history.push(chosen);
        return chosen;
      }
      return '';
    }

    if (v) this.history.push(v);
    return v;
  }

  async pickCommand(): Promise<string | null> {
    if (!this.commands.length) return null;

    const res = await search({
      message: 'Command palette',
      source: async (term) => {
        const t = (term ?? '').toLowerCase();
        const filtered = !t
          ? this.commands
          : this.commands.filter((c) =>
              c.value.toLowerCase().includes(t) ||
              c.name.toLowerCase().includes(t) ||
              (c.description ?? '').toLowerCase().includes(t)
            );

        return filtered.map((c) => ({
          name: c.description ? `${c.value} — ${c.description}` : c.value,
          value: c.value,
        }));
      },
    });

    return res ?? null;
  }
}

export const promptEngine = new PromptEngine();
