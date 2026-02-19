import { Command, Args }  from '@oclif/core';
import { createInterface } from 'readline';
import { writeFileSync }   from 'fs';
import { ConfigService }   from '../services/config.service.js';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const o  = (s: string) => process.stdout.write(s);
const A  = {
  r:  '\x1b[0m',   b: '\x1b[1m',    d: '\x1b[2m',
  cy: '\x1b[36m',  gr: '\x1b[32m',  ye: '\x1b[33m',
  re: '\x1b[31m',  gy: '\x1b[90m',  wh: '\x1b[97m',
  mg: '\x1b[35m',
};
const p  = (col: string, s: string) => `${col}${s}${A.r}`;
const HR = '─'.repeat(48);

// ─── Prompt helper (temporarily disables raw mode) ───────────────────────────

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input:  process.stdin,
      output: hidden ? undefined : process.stdout,
    });

    if (hidden) {
      // Write question manually without echo for password-style input
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let answer = '';
      const onData = (char: Buffer | string) => {
        const c = typeof char === 'string' ? char : char.toString('utf8');
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(answer);
        } else if (c === '\x7f' || c === '\b') {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (c === '\u0003') {
          process.stdin.setRawMode(false);
          rl.close();
          process.exit(0);
        } else if (c.charCodeAt(0) >= 32) {
          answer += c;
          process.stdout.write('•');  // mask character
        }
      };
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function askSelect(question: string, choices: { title: string; value: string }[]): Promise<string> {
  return new Promise((resolve) => {
    let sel = 0;

    const draw = () => {
      // Erase and redraw choices
      process.stdout.write('\r\x1b[2K');
      o(question + '\n');
      choices.forEach((c, i) => {
        const marker = i === sel ? p(A.ye + A.b, ' ❯ ') : '   ';
        const label  = i === sel ? p(A.cy + A.b, c.title) : p(A.gy, c.title);
        o(`${marker}${label}\n`);
      });
      // Move cursor back up
      o(`\x1b[${choices.length + 1}A`);
    };

    draw();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onKey = (k: string) => {
      if (k === '\x1b[A' && sel > 0) { sel--; draw(); }
      else if (k === '\x1b[B' && sel < choices.length - 1) { sel++; draw(); }
      else if (k === '\r' || k === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKey);
        // Clear the menu rows
        for (let i = 0; i < choices.length + 1; i++) o('\n\x1b[2K\x1b[1A');
        o('\n');
        o(`  ${p(A.gy, '→')} ${p(A.cy + A.b, choices[sel].title)}\n`);
        resolve(choices[sel].value);
      } else if (k === '\u0003') { process.stdin.setRawMode(false); process.exit(0); }
    };

    process.stdin.on('data', onKey);
  });
}

// ─── Config Command ───────────────────────────────────────────────────────────

export default class Config extends Command {
  static override description = 'Manage Optimus configuration — API keys, provider, model';

  static override args = {
    subcommand: Args.string({
      description: 'Subcommand: show | set-key | set-provider | set-model | reset',
      required: false,
    }),
  };

  static override examples = [
    '<%= config.bin %> config              # interactive menu',
    '<%= config.bin %> config show         # print current config',
    '<%= config.bin %> config set-key      # update API key',
    '<%= config.bin %> config set-provider # change provider',
    '<%= config.bin %> config set-model    # change default model',
    '<%= config.bin %> config reset        # wipe and re-init',
  ];

  async run(): Promise<void> {
    const { args } = await this.parse(Config);
    const sub = args.subcommand ?? '';

    switch (sub) {
      case 'show':         return this._show();
      case 'set-key':      return this._setKey();
      case 'set-provider': return this._setProvider();
      case 'set-model':    return this._setModel();
      case 'reset':        return this._reset();
      default:             return this._menu();
    }
  }

  // ─── Interactive main menu ───────────────────────────────────────────────

  private async _menu() {
    o('\n');
    o(p(A.ye + A.b, '  ╔══════════════════════════════════════════════════╗\n'));
    o(p(A.ye + A.b, '  ║') + p(A.wh + A.b, '  ⚙  Optimus Configuration                      ') + p(A.ye + A.b, '║\n'));
    o(p(A.ye + A.b, '  ╚══════════════════════════════════════════════════╝\n\n'));

    this._printCurrentConfig();

    const choice = await askSelect(
      p(A.b + A.wh, '\n  What would you like to do?'),
      [
        { title: 'Show current config',     value: 'show'     },
        { title: 'Update API key',          value: 'set-key'  },
        { title: 'Change AI provider',      value: 'set-provider' },
        { title: 'Change default model',    value: 'set-model' },
        { title: 'Reset & re-initialize',   value: 'reset'    },
        { title: 'Exit',                    value: 'exit'     },
      ],
    );

    if (choice === 'exit') { o(p(A.gy, '  Bye.\n\n')); return; }
    if (choice === 'show')         return this._show();
    if (choice === 'set-key')      return this._setKey();
    if (choice === 'set-provider') return this._setProvider();
    if (choice === 'set-model')    return this._setModel();
    if (choice === 'reset')        return this._reset();
  }

  // ─── show ─────────────────────────────────────────────────────────────────

  private _show() {
    o('\n');
    if (!ConfigService.isInitialized()) {
      o(p(A.re, '  ✘  Not initialized.\n'));
      o(p(A.gy, '  Run: ') + p(A.cy, 'ai init\n\n'));
      return;
    }
    this._printCurrentConfig();
    o('\n');
  }

  private _printCurrentConfig() {
    try {
      const cfg    = ConfigService.loadConfig();
      const rawKey = ConfigService.getApiKey();
      const masked = rawKey.slice(0, 7) + '••••••••' + rawKey.slice(-4);

      o(p(A.b + A.wh, `  Current Config\n`));
      o(p(A.gy, `  ${HR}\n`));
      o(`  Workspace  : ${p(A.cy, cfg.workspaceName)}\n`);
      o(`  Provider   : ${p(A.cy, cfg.apiProvider.toUpperCase())}\n`);
      o(`  API Key    : ${p(A.gy, masked)}\n`);
      o(`  Config dir : ${p(A.gy, ConfigService.getConfigDir())}\n`);
      o(`  Created    : ${p(A.gy, new Date(cfg.createdAt).toLocaleString())}\n`);
      o(p(A.gy, `  ${HR}\n`));
    } catch {
      o(p(A.re, '  ✘  Could not read config.\n'));
    }
  }

  // ─── set-key ──────────────────────────────────────────────────────────────

  private async _setKey() {
    if (!ConfigService.isInitialized()) {
      o(p(A.re, '\n  ✘  Run ai init first.\n\n'));
      return;
    }
    const cfg = ConfigService.loadConfig();

    o('\n');
    o(p(A.b + A.wh, '  Update API Key\n'));
    o(p(A.gy, `  ${HR}\n`));
    o(`  Provider : ${p(A.cy, cfg.apiProvider.toUpperCase())}\n\n`);

    const rawKey = await ask(
      p(A.cy, '  Enter new API key: '),
      true,  /* hidden */
    );

    if (!rawKey || rawKey.trim().length === 0) {
      o(p(A.re, '\n  ✘  Empty key — no changes made.\n\n'));
      return;
    }

    if (!ConfigService.validateApiKey(rawKey, cfg.apiProvider)) {
      o(p(A.ye, `\n  ⚠  Key format looks wrong for ${cfg.apiProvider} (saving anyway).\n`));
    }

    ConfigService.updateConfig({ apiKeyEncrypted: ConfigService.encryptApiKey(rawKey) });
    o(p(A.gr, `\n  ✔  API key updated.\n\n`));
  }

  // ─── set-provider ─────────────────────────────────────────────────────────

  private async _setProvider() {
    if (!ConfigService.isInitialized()) {
      o(p(A.re, '\n  ✘  Run ai init first.\n\n'));
      return;
    }

    o('\n');
    o(p(A.b + A.wh, '  Change AI Provider\n'));
    o(p(A.gy, `  ${HR}\n\n`));

    const provider = await askSelect(
      p(A.b, '  Select provider:'),
      [
        { title: 'OpenAI       (GPT-4o, GPT-3.5…)',        value: 'openai'    },
        { title: 'Anthropic    (Claude 3 Opus/Sonnet…)',    value: 'anthropic' },
        { title: 'Google       (Gemini 2.0/1.5 Pro…)',      value: 'gemini'    },
      ],
    );

    ConfigService.updateConfig({ apiProvider: provider as 'openai' | 'anthropic' | 'gemini' });

    o('\n');
    o(p(A.gr, `  ✔  Provider set to: `) + p(A.cy + A.b, provider.toUpperCase()) + '\n');
    o(p(A.gy, '  Your existing API key is still stored — update it with:\n'));
    o(p(A.gy, '  ') + p(A.cy, 'ai config set-key\n\n'));
  }

  // ─── set-model ────────────────────────────────────────────────────────────

  private async _setModel() {
    if (!ConfigService.isInitialized()) {
      o(p(A.re, '\n  ✘  Run ai init first.\n\n'));
      return;
    }

    const cfg = ConfigService.loadConfig();

    const modelsByProvider: Record<string, { title: string; value: string }[]> = {
      openai: [
        { title: 'gpt-4o          (recommended)',       value: 'gpt-4o'          },
        { title: 'gpt-4o-mini     (fast & cheap)',      value: 'gpt-4o-mini'     },
        { title: 'gpt-4-turbo',                         value: 'gpt-4-turbo'     },
        { title: 'gpt-4',                               value: 'gpt-4'           },
        { title: 'gpt-3.5-turbo   (very fast)',         value: 'gpt-3.5-turbo'   },
      ],
      anthropic: [
        { title: 'claude-3-5-sonnet-20241022 (best)',   value: 'claude-3-5-sonnet-20241022' },
        { title: 'claude-3-opus-20240229',              value: 'claude-3-opus-20240229'     },
        { title: 'claude-3-sonnet-20240229',            value: 'claude-3-sonnet-20240229'   },
        { title: 'claude-3-haiku-20240307  (fast)',     value: 'claude-3-haiku-20240307'    },
      ],
      gemini: [
        { title: 'gemini-2.0-flash     (recommended)',  value: 'gemini-2.0-flash'      },
        { title: 'gemini-2.5-flash',                    value: 'gemini-2.5-flash'      },
        { title: 'gemini-1.5-pro',                      value: 'gemini-1.5-pro'        },
        { title: 'gemini-1.5-flash',                    value: 'gemini-1.5-flash'      },
      ],
    };

    const choices = modelsByProvider[cfg.apiProvider] ?? [];

    o('\n');
    o(p(A.b + A.wh, '  Change Default Model\n'));
    o(p(A.gy, `  ${HR}\n`));
    o(`  Provider : ${p(A.cy, cfg.apiProvider.toUpperCase())}\n\n`);

    if (!choices.length) {
      o(p(A.ye, '  No preset models available for this provider.\n'));
      const model = await ask(p(A.cy, '  Enter model name manually: '));
      if (!model) { o(p(A.re, '  ✘  Cancelled.\n\n')); return; }
      // Store in a config extension field (model hint)
      this._saveModelHint(model);
      o(p(A.gr, `\n  ✔  Default model set to: `) + p(A.cy + A.b, model) + '\n\n');
      return;
    }

    // Add "enter manually" option
    choices.push({ title: '── Enter custom model name ──', value: '__custom__' });

    const model = await askSelect(p(A.b, '  Select model:'), choices);

    if (model === '__custom__') {
      const custom = await ask(p(A.cy, '\n  Model name: '));
      if (!custom) { o(p(A.re, '\n  ✘  Cancelled.\n\n')); return; }
      this._saveModelHint(custom);
      o(p(A.gr, `\n  ✔  Default model set to: `) + p(A.cy + A.b, custom) + '\n\n');
    } else {
      this._saveModelHint(model);
      o('\n');
      o(p(A.gr, `  ✔  Default model set to: `) + p(A.cy + A.b, model) + '\n');
      o(p(A.gy, '  This will be used when you run: ') + p(A.cy, 'ai chat\n\n'));
    }
  }

  /** Stores the model hint in the config JSON as an extra field */
  private _saveModelHint(model: string) {
    const cfg = ConfigService.loadConfig();
    const upd = { ...cfg, defaultModel: model } as any;
    writeFileSync(ConfigService.getConfigFile(), JSON.stringify(upd, null, 2), 'utf-8');
  }

  // ─── reset ────────────────────────────────────────────────────────────────

  private async _reset() {
    o('\n');
    o(p(A.re + A.b, '  ⚠  Reset will erase your stored API key and config.\n'));
    const confirm = await ask(p(A.ye, '  Type YES to confirm: '));
    if (confirm !== 'YES') {
      o(p(A.gy, '\n  Cancelled.\n\n'));
      return;
    }
    ConfigService.deleteConfig();
    o(p(A.gr, '\n  ✔  Config wiped.\n'));
    o(p(A.gy, '  Run ') + p(A.cy, 'ai init') + p(A.gy, ' to set up again.\n\n'));
  }
}
