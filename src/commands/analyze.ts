import { Command, Args, Flags } from '@oclif/core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  AnalyzerService,
  ProjectAnalysis,
  TreeNode,
  FileAnalysis,
  fmt,
  langsSorted,
} from '../services/analyzer.service.js';

// ─── ANSI ──────────────────────────────────────────────────────────────────
const o = (s: string) => process.stdout.write(s);
const A = {
  r:  '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  cy: '\x1b[36m', gr: '\x1b[32m', ye: '\x1b[33m',
  re: '\x1b[31m', gy: '\x1b[90m', wh: '\x1b[97m',
  mg: '\x1b[35m', bl: '\x1b[34m',
};
const p = (col: string, s: string) => `${col}${s}${A.r}`;

// ─── Language → colour ─────────────────────────────────────────────────────
const LANG_COLOR: Record<string, string> = {
  TypeScript:  A.bl,
  JavaScript:  A.ye,
  Python:      A.gr,
  Go:          A.cy,
  Rust:        A.mg,
  Markdown:    A.wh,
  JSON:        A.gy,
  YAML:        A.gy,
  HTML:        A.re,
  CSS:         A.mg,
  Shell:       A.gr,
};
const langColor = (l: string) => LANG_COLOR[l] ?? A.gy;

// ─── Tree renderer ─────────────────────────────────────────────────────────
function renderTree(
  node: TreeNode,
  prefix = '',
  isLast = true,
  depth = 0,
  maxDepth = 5,
  out: string[] = [],
): string[] {
  if (depth > maxDepth) return out;

  const connector = isLast ? '└── ' : '├── ';
  const childPfx  = isLast ? '    ' : '│   ';

  if (depth === 0) {
    // root
    out.push(p(A.ye + A.b, `📁 ${node.name}/`));
  } else if (node.type === 'dir') {
    out.push(`${prefix}${p(A.gy, connector)}${p(A.ye, `📁 ${node.name}/`)}`);
  } else {
    const f = node.file!;
    const lang  = p(langColor(f.language), f.language.padEnd(12));
    const lines = f.lines ? p(A.gy, ` ${f.lines} lines`) : '';
    out.push(`${prefix}${p(A.gy, connector)}${p(A.wh, node.name)}  ${lang}${lines}`);
  }

  if (node.children) {
    const children = node.children;
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      renderTree(child, prefix + (depth === 0 ? '' : childPfx), last, depth + 1, maxDepth, out);
    });
  }

  return out;
}

// ─── Progress spinner ──────────────────────────────────────────────────────
function startSpinner(): () => void {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const t = setInterval(() => {
    process.stdout.write(`\r${p(A.cy, frames[i++ % frames.length])}  ${p(A.gy, 'Analyzing project…')}`);
  }, 80);
  return () => {
    clearInterval(t);
    process.stdout.write('\r\x1b[2K'); // clear line
  };
}

// ─── Command ───────────────────────────────────────────────────────────────
export default class Analyze extends Command {
  static override description = 'Analyze project file structure, languages, imports and exports';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> ./my-project',
    '<%= config.bin %> <%= command.id %> --save',
    '<%= config.bin %> <%= command.id %> --depth 3',
  ];

  static override args = {
    path: Args.string({
      description: 'Project path to analyze (defaults to current directory)',
      default: '.',
    }),
  };

  static override flags = {
    save: Flags.boolean({
      char: 's',
      description: 'Save analysis as markdown + JSON to ~/.multi-agent/analysis/',
      default: false,
    }),
    depth: Flags.integer({
      char: 'd',
      description: 'Max depth for tree display',
      default: 5,
    }),
    files: Flags.boolean({
      char: 'f',
      description: 'Show detailed per-file breakdown',
      default: false,
    }),
    deps: Flags.boolean({
      description: 'Show local dependency map',
      default: false,
    }),
  };

  async run() {
    const { args, flags } = await this.parse(Analyze);
    const target = resolve(args.path);

    const stop = startSpinner();
    let analysis: ProjectAnalysis;

    try {
      analysis = new AnalyzerService().analyze(target);
    } catch (err: any) {
      stop();
      this.error(err.message);
    } finally {
      stop();
    }

    // ── Header ──────────────────────────────────────────────────────────────
    const bar = '─'.repeat(54);
    o('\n');
    o(p(A.cy, `  ╭${bar}╮\n`));
    o(p(A.cy, '  │') +
      p(A.b + A.wh, `  📊 Project Analysis  ·  ${analysis!.name}`.padEnd(54)) +
      p(A.cy, '│\n'));
    o(p(A.cy, '  │') +
      p(A.gy, `  ${analysis!.totalFiles} files  ·  ${analysis!.totalLines.toLocaleString()} lines  ·  ${fmt(analysis!.totalBytes)}`.padEnd(54)) +
      p(A.cy, '│\n'));
    o(p(A.cy, `  ╰${bar}╯\n`));
    o('\n');

    // ── Language breakdown ───────────────────────────────────────────────
    o(p(A.b, '  📚 Languages\n\n'));
    const sortedLangs = langsSorted(analysis!.languages);
    const maxFiles = Math.max(...sortedLangs.map(([, v]) => v.files));
    for (const [lang, stat] of sortedLangs) {
      const col     = langColor(lang);
      const barLen  = Math.round((stat.files / maxFiles) * 20);
      const bar2    = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
      const pct     = Math.round((stat.lines / analysis!.totalLines) * 100);
      o(
        `  ${p(col, lang.padEnd(14))}` +
        `${p(A.gy, bar2)}  ` +
        `${p(A.wh, String(stat.files).padStart(4))} files  ` +
        `${p(A.gy, stat.lines.toLocaleString().padStart(8) + ' lines')}  ` +
        `${p(A.d + A.gy, pct + '%')}\n`
      );
    }
    o('\n');

    // ── Tree ────────────────────────────────────────────────────────────
    o(p(A.b, '  📁 Project Structure\n\n'));
    const treeLines = renderTree(analysis!.tree, '  ', true, 0, flags.depth);
    treeLines.forEach(l => o(`  ${l}\n`));
    o('\n');

    // ── Per-file breakdown ───────────────────────────────────────────────
    if (flags.files) {
      o(p(A.b, '  📄 File Details\n\n'));
      for (const f of analysis!.files) {
        const col = langColor(f.language);
        o(`  ${p(col + A.b, f.path)}\n`);
        o(`  ${p(A.gy, '  Language:')} ${p(col, f.language)}   ${p(A.gy, 'Lines:')} ${p(A.wh, String(f.lines))}   ${p(A.gy, 'Size:')} ${p(A.wh, fmt(f.size))}\n`);
        if (f.imports.length) {
          o(`  ${p(A.gy, '  Imports:')}  ${f.imports.map(i => p(A.cy, i)).join(', ')}\n`);
        }
        if (f.exports.length) {
          o(`  ${p(A.gy, '  Exports:')}  ${f.exports.map(e => p(A.gr, e)).join(', ')}\n`);
        }
        o('\n');
      }
    }

    // ── Top files by size ────────────────────────────────────────────────
    const topFiles = [...analysis!.files]
      .filter(f => f.lines > 0)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 8);

    o(p(A.b, '  🏆 Largest Files\n\n'));
    topFiles.forEach((f, i) => {
      const col    = langColor(f.language);
      const pct    = Math.round((f.lines / analysis!.totalLines) * 100);
      const barLen = Math.round(pct * 0.3);
      const bar3   = '▓'.repeat(Math.max(1, barLen));
      o(
        `  ${p(A.gy, String(i + 1).padStart(2))}. ` +
        `${p(A.wh, f.path.padEnd(42))}` +
        `${p(col, bar3.padEnd(8))}` +
        `${p(A.gy, String(f.lines).padStart(6) + ' lines')}\n`
      );
    });
    o('\n');

    // ── Dependency map ───────────────────────────────────────────────────
    if (flags.deps && Object.keys(analysis!.dependencyMap).length) {
      o(p(A.b, '  🔗 Local Dependency Map\n\n'));
      for (const [file, deps] of Object.entries(analysis!.dependencyMap)) {
        o(`  ${p(A.cy, file)}\n`);
        deps.forEach(d => o(`    ${p(A.gy, '→')} ${p(A.wh, d)}\n`));
      }
      o('\n');
    }

    // ── Save ─────────────────────────────────────────────────────────────
    if (flags.save) {
      const outDir = join(homedir(), '.multi-agent', 'analysis');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

      const slug = analysis!.name.replace(/[^a-z0-9]/gi, '-');
      const mdPath   = join(outDir, `${slug}.md`);
      const jsonPath = join(outDir, `${slug}.json`);

      const svc = new AnalyzerService();
      writeFileSync(mdPath,   svc.toMarkdown(analysis!), 'utf-8');
      writeFileSync(jsonPath, JSON.stringify(analysis!, null, 2), 'utf-8');

      o(p(A.gr, `  ✔ Markdown saved → ${mdPath}\n`));
      o(p(A.gr, `  ✔ JSON saved     → ${jsonPath}\n`));
      o(p(A.gy, `\n  Tip: Feed the markdown file to your LLM for codebase context.\n`));
      o('\n');
    } else {
      o(p(A.gy, `  Tip: Run with --save to export a markdown summary for LLM context.\n\n`));
    }
  }
}
