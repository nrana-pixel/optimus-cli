/**
 * Analyzer Service
 * Recursively analyzes a project's file structure, languages,
 * imports/exports, and builds a rich summary for LLM context.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, extname, basename, resolve, dirname } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileAnalysis {
  path: string;          // relative to project root
  name: string;
  ext: string;
  language: string;
  lines: number;
  size: number;          // bytes
  imports: string[];
  exports: string[];
}

export interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  file?: FileAnalysis;
  children?: TreeNode[];
}

export interface ProjectAnalysis {
  root: string;
  name: string;
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  languages: Record<string, { files: number; lines: number }>;
  files: FileAnalysis[];
  tree: TreeNode;
  dependencyMap: Record<string, string[]>;
}

// ─── Language map ────────────────────────────────────────────────────────────

const LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go',
  '.rs': 'Rust', '.java': 'Java', '.cs': 'C#',
  '.cpp': 'C++', '.cc': 'C++', '.c': 'C', '.h': 'C Header',
  '.json': 'JSON', '.jsonc': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML', '.ini': 'INI', '.env': 'Env',
  '.md': 'Markdown', '.mdx': 'Markdown',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SASS', '.less': 'LESS',
  '.sql': 'SQL', '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.xml': 'XML', '.svg': 'SVG', '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.prisma': 'Prisma', '.proto': 'Protobuf',
};

// ─── Default ignore patterns ──────────────────────────────────────────────

const DEFAULT_IGNORES = [
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', 'env', '.DS_Store', 'Thumbs.db',
  '*.log', '*.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  '*.min.js', '*.min.css', '*.map', '*.d.ts',
  '.turbo', '.vercel', '.netlify', 'storybook-static',
];

// ─── Import/export extractors ─────────────────────────────────────────────

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  TypeScript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
    /import\(['"]([^'"]+)['"]\)/g,
  ],
  JavaScript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
    /import\(['"]([^'"]+)['"]\)/g,
  ],
  Python: [
    /^import\s+([\w.]+)/gm,
    /^from\s+([\w.]+)\s+import/gm,
  ],
  Go: [
    /["']([\w./]+)["']/g,
  ],
};

const EXPORT_PATTERNS: Record<string, RegExp[]> = {
  TypeScript: [
    /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)/g,
    /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
    /export\s*\{([^}]+)\}/g,
  ],
  JavaScript: [
    /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)/g,
    /export\s+(?:const|let|var|function|class)\s+(\w+)/g,
    /module\.exports\s*=\s*(\w+)/g,
  ],
};

// ─── Gitignore parser ─────────────────────────────────────────────────────

function loadIgnorePatterns(projectRoot: string): string[] {
  const patterns = [...DEFAULT_IGNORES];
  const gitignorePath = join(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const lines = readFileSync(gitignorePath, 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (t && !t.startsWith('#') && !t.startsWith('!')) {
        patterns.push(t);
      }
    }
  }
  return patterns;
}

function isIgnored(filePath: string, patterns: string[]): boolean {
  const name   = basename(filePath);
  const parts  = filePath.replace(/\\/g, '/').split('/');

  for (const raw of patterns) {
    const pat = raw.replace(/\\/g, '/');

    // Exact segment match (e.g. "node_modules" matches any path segment)
    if (parts.includes(pat)) return true;
    if (parts.includes(pat.replace(/\/$/, ''))) return true;

    // Exact name match
    if (pat === name) return true;

    // Glob: *.ext
    if (pat.startsWith('*.')) {
      if (name.endsWith(pat.slice(1))) return true;
    }

    // Glob: prefix*
    if (pat.endsWith('*') && !pat.startsWith('*')) {
      if (name.startsWith(pat.slice(0, -1))) return true;
    }
  }
  return false;
}

// ─── Import / export extractors ───────────────────────────────────────────

function extractImports(content: string, language: string): string[] {
  const patterns = IMPORT_PATTERNS[language] ?? [];
  const found = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(content)) !== null) {
      found.add(m[1]);
    }
  }
  return [...found].slice(0, 20); // cap at 20
}

function extractExports(content: string, language: string): string[] {
  const patterns = EXPORT_PATTERNS[language] ?? [];
  const found = new Set<string>();
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(content)) !== null) {
      const names = m[1].split(',').map(s => s.trim().split(' ')[0]).filter(Boolean);
      names.forEach(n => found.add(n));
    }
  }
  return [...found].slice(0, 20);
}

// ─── File analyzer ────────────────────────────────────────────────────────

function analyzeFile(absPath: string, relPath: string): FileAnalysis {
  const st   = statSync(absPath);
  const ext  = extname(absPath).toLowerCase();
  const lang = LANG[ext] ?? 'Other';

  let lines   = 0;
  let imports: string[] = [];
  let exports: string[] = [];

  // Only read text files under 500 KB
  if (st.size < 512_000 && lang !== 'Other') {
    try {
      const content = readFileSync(absPath, 'utf-8');
      lines   = content.split('\n').length;
      imports = extractImports(content, lang);
      exports = extractExports(content, lang);
    } catch { /* binary or unreadable */ }
  }

  return {
    path: relPath.replace(/\\/g, '/'),
    name: basename(absPath),
    ext,
    language: lang,
    lines,
    size: st.size,
    imports,
    exports,
  };
}

// ─── Recursive walker ─────────────────────────────────────────────────────

function walk(
  dir: string,
  root: string,
  ignorePatterns: string[],
  files: FileAnalysis[],
  visited: Set<string> = new Set(),
): TreeNode {
  const name     = basename(dir);
  const node: TreeNode = { name, type: 'dir', children: [] };
  let entries: string[] = [];

  // Cycle detection for symlinks
  let realDir: string;
  try {
    realDir = resolve(dir);
    if (visited.has(realDir)) return node;
    visited.add(realDir);
  } catch {
    return node;
  }

  try { entries = readdirSync(dir); } catch { return node; }

  // Cache stat results to avoid redundant calls during sort
  const entryStats = new Map<string, { isDir: boolean; stat: ReturnType<typeof statSync> }>();
  for (const entry of entries) {
    try {
      const st = statSync(join(dir, entry));
      entryStats.set(entry, { isDir: st.isDirectory(), stat: st });
    } catch {
      // skip entries we can't stat
    }
  }

  // Filter to only statable entries and sort
  entries = entries.filter(e => entryStats.has(e));
  entries.sort((a, b) => {
    const aIsDir = entryStats.get(a)!.isDir;
    const bIsDir = entryStats.get(b)!.isDir;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });

  for (const entry of entries) {
    const abs = join(dir, entry);
    const rel = relative(root, abs);

    if (isIgnored(rel, ignorePatterns) || isIgnored(entry, ignorePatterns)) continue;

    try {
      const { isDir } = entryStats.get(entry)!;
      if (isDir) {
        const child = walk(abs, root, ignorePatterns, files, visited);
        if (child.children && child.children.length > 0) {
          node.children!.push(child);
        }
      } else {
        const fa = analyzeFile(abs, rel);
        files.push(fa);
        node.children!.push({ name: entry, type: 'file', file: fa });
      }
    } catch { /* skip permission errors */ }
  }

  return node;
}

// ─── Public API ───────────────────────────────────────────────────────────

export class AnalyzerService {
  analyze(projectRoot: string): ProjectAnalysis {
    const absRoot = resolve(projectRoot);
    if (!existsSync(absRoot)) throw new Error(`Path not found: ${absRoot}`);

    const ignorePatterns = loadIgnorePatterns(absRoot);
    const files: FileAnalysis[] = [];
    const tree = walk(absRoot, absRoot, ignorePatterns, files);
    tree.name = basename(absRoot);

    // Language stats
    const languages: Record<string, { files: number; lines: number }> = {};
    let totalLines = 0;
    let totalBytes = 0;

    for (const f of files) {
      const lang = f.language;
      if (!languages[lang]) languages[lang] = { files: 0, lines: 0 };
      languages[lang].files++;
      languages[lang].lines += f.lines;
      totalLines += f.lines;
      totalBytes += f.size;
    }

    // Dependency map: resolve local imports to relative paths
    const dependencyMap: Record<string, string[]> = {};
    for (const f of files) {
      const localImports = f.imports.filter(i =>
        i.startsWith('.') || i.startsWith('/')
      );
      if (localImports.length) dependencyMap[f.path] = localImports;
    }

    // Detect package name
    let name = basename(absRoot);
    const pkgPath = join(absRoot, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) name = pkg.name;
      } catch {}
    }

    return {
      root: absRoot,
      name,
      totalFiles: files.length,
      totalLines,
      totalBytes,
      languages,
      files,
      tree,
      dependencyMap,
    };
  }

  /** Render a compact text representation for LLM context */
  toMarkdown(analysis: ProjectAnalysis): string {
    const lines: string[] = [];
    lines.push(`# Project: ${analysis.name}\n`);
    lines.push(`**Files:** ${analysis.totalFiles}  **Lines:** ${analysis.totalLines.toLocaleString()}  **Size:** ${fmt(analysis.totalBytes)}\n`);

    lines.push('\n## Languages\n');
    for (const [lang, stat] of langsSorted(analysis.languages)) {
      lines.push(`- ${lang}: ${stat.files} files, ${stat.lines.toLocaleString()} lines`);
    }

    lines.push('\n## File Index\n');
    for (const f of analysis.files) {
      lines.push(`### ${f.path}`);
      lines.push(`- Language: ${f.language}  Lines: ${f.lines}  Size: ${fmt(f.size)}`);
      if (f.imports.length) lines.push(`- Imports: ${f.imports.join(', ')}`);
      if (f.exports.length) lines.push(`- Exports: ${f.exports.join(', ')}`);
    }

    if (Object.keys(analysis.dependencyMap).length) {
      lines.push('\n## Local Dependencies\n');
      for (const [file, deps] of Object.entries(analysis.dependencyMap)) {
        lines.push(`- **${file}** → ${deps.join(', ')}`);
      }
    }

    return lines.join('\n');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function langsSorted(
  languages: Record<string, { files: number; lines: number }>,
): [string, { files: number; lines: number }][] {
  return Object.entries(languages).sort((a, b) => b[1].lines - a[1].lines);
}
