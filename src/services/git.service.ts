/**
 * Git Service
 * Provides git integration: repo detection, backup branches,
 * auto-commit, diff display, and rollback capability.
 * Uses simple-git under the hood.
 */

import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GitStatus {
  isRepo: boolean;
  isClean: boolean;
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
  staged: string[];
  deleted: string[];
}

export interface CommitResult {
  hash: string;
  branch: string;
  message: string;
  filesChanged: number;
}

export interface LogEntry {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
  refs: string;
}

export interface BackupResult {
  backupBranch: string;
  fromBranch: string;
  fromHash: string;
}

// ─── GitService ──────────────────────────────────────────────────────────────

export class GitService {
  private git: SimpleGit;
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.git = simpleGit({
      baseDir: workingDir,
      binary: 'git',
      maxConcurrentProcesses: 4,
      trimmed: true,
    } as Partial<SimpleGitOptions>);
  }

  // ─── Repo detection ────────────────────────────────────────────────────────

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.git.revparse(['HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  async getStatus(): Promise<GitStatus> {
    const isRepo = await this.isGitRepo();
    if (!isRepo) {
      return {
        isRepo: false,
        isClean: true,
        branch: '',
        ahead: 0,
        behind: 0,
        modified: [],
        untracked: [],
        staged: [],
        deleted: [],
      };
    }

    try {
      const status = await this.git.status();
      return {
        isRepo: true,
        isClean: status.isClean(),
        branch: status.current || 'HEAD',
        ahead: status.ahead,
        behind: status.behind,
        modified: status.modified,
        untracked: status.not_added,
        staged: status.staged,
        deleted: status.deleted,
      };
    } catch {
      return {
        isRepo: true,
        isClean: true,
        branch: 'unknown',
        ahead: 0,
        behind: 0,
        modified: [],
        untracked: [],
        staged: [],
        deleted: [],
      };
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      return (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    } catch {
      return 'HEAD';
    }
  }

  async getCurrentHash(): Promise<string> {
    try {
      return (await this.git.revparse(['HEAD'])).trim().slice(0, 8);
    } catch {
      return '';
    }
  }

  // ─── Backup branch ────────────────────────────────────────────────────────

  /**
   * Creates a backup branch at current HEAD before AI makes changes.
   * Branch name: ai-backup/{slug}-{timestamp}
   * Does NOT switch to it — stays on current branch.
   */
  async createBackupBranch(taskSlug: string): Promise<BackupResult> {
    const fromBranch = await this.getCurrentBranch();
    const fromHash   = await this.getCurrentHash();

    const hasCommits = await this.hasCommits();
    if (!hasCommits) {
      return { backupBranch: '', fromBranch, fromHash: '' };
    }

    const ts          = Math.floor(Date.now() / 1000);
    const slug        = taskSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30)
      .replace(/-$/, '');
    const backupBranch = `ai-backup/${slug}-${ts}`;

    // Create branch at current HEAD without checking out
    await this.git.branch([backupBranch]);

    return { backupBranch, fromBranch, fromHash };
  }

  async deleteBackupBranch(branchName: string): Promise<void> {
    try {
      await this.git.branch(['-D', branchName]);
    } catch { /* ignore */ }
  }

  // ─── Stage & Commit ───────────────────────────────────────────────────────

  async stageFiles(filePaths: string[]): Promise<void> {
    await this.git.add(filePaths);
  }

  async stageAll(): Promise<void> {
    await this.git.add('.');
  }

  async commit(message: string, body?: string): Promise<CommitResult> {
    const fullMessage = body ? `${message}\n\n${body}` : message;
    const result      = await this.git.commit(fullMessage);
    const branch      = await this.getCurrentBranch();

    return {
      hash:         result.commit.slice(0, 8),
      branch,
      message,
      filesChanged: result.summary.changes,
    };
  }

  async configureUser(): Promise<void> {
    // Ensure git user is set (needed in CI-like envs)
    try {
      await this.git.raw(['config', 'user.email']);
    } catch {
      await this.git.addConfig('user.email', 'ai-agent@local');
      await this.git.addConfig('user.name', 'AI Agent');
    }
  }

  // ─── Diff ────────────────────────────────────────────────────────────────

  async getDiff(fromRef = 'HEAD', paths?: string[]): Promise<string> {
    try {
      const args = ['--stat', fromRef];
      if (paths?.length) args.push('--', ...paths);
      return await this.git.diff(args);
    } catch {
      return '';
    }
  }

  async getDiffFull(fromRef = 'HEAD', paths?: string[]): Promise<string> {
    try {
      const args: string[] = [fromRef];
      if (paths?.length) args.push('--', ...paths);
      return await this.git.diff(args);
    } catch {
      return '';
    }
  }

  async getStagedDiff(): Promise<string> {
    try {
      return await this.git.diff(['--cached', '--stat']);
    } catch {
      return '';
    }
  }

  // ─── Log ─────────────────────────────────────────────────────────────────

  async getLog(count = 10): Promise<LogEntry[]> {
    try {
      const log = await this.git.log({
        maxCount: count,
        format: {
          hash:      '%H',
          shortHash: '%h',
          date:      '%ar',
          message:   '%s',
          author:    '%an',
          refs:      '%D',
        },
      });

      return log.all.map(e => ({
        hash:      e.hash,
        shortHash: e.hash.slice(0, 8),
        date:      e.date,
        message:   e.message,
        author:    (e as any).author_name ?? '',
        refs:      (e as any).refs ?? '',
      }));
    } catch {
      return [];
    }
  }

  // ─── Rollback ─────────────────────────────────────────────────────────────

  /**
   * Hard reset to a specific branch or commit ref.
   * This discards all uncommitted changes — use with care.
   */
  async rollbackToRef(ref: string): Promise<void> {
    await this.git.reset(['--hard', ref]);
  }

  /**
   * Soft reset — keeps working tree changes, just moves HEAD back.
   */
  async undoLastCommit(): Promise<void> {
    await this.git.reset(['--soft', 'HEAD~1']);
  }

  /**
   * Restore to backup branch (merge/reset current branch to backup point).
   */
  async restoreFromBackup(backupBranch: string): Promise<void> {
    await this.git.reset(['--hard', backupBranch]);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async listBranches(): Promise<string[]> {
    try {
      const result = await this.git.branch(['--all']);
      return result.all;
    } catch {
      return [];
    }
  }

  async listBackupBranches(): Promise<string[]> {
    const all = await this.listBranches();
    return all.filter(b => b.trim().startsWith('ai-backup/'));
  }

  /** Generate a conventional commit message from a task description */
  static buildCommitMessage(task: string, files: string[]): string {
    const type = inferCommitType(task);
    const scope = files.length === 1
      ? files[0].split('/').pop()?.replace(/\.[^.]+$/, '')
      : undefined;

    const subject = task.length > 60 ? task.slice(0, 57) + '...' : task;
    const header  = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;

    const body = [
      `Files changed: ${files.join(', ')}`,
      `Generated by AI agent`,
    ].join('\n');

    return `${header}\n\n${body}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function inferCommitType(task: string): string {
  const t = task.toLowerCase();
  if (/\b(fix|bug|error|issue|crash|broken)\b/.test(t))  return 'fix';
  if (/\b(test|spec|coverage)\b/.test(t))                 return 'test';
  if (/\b(doc|readme|comment|jsdoc)\b/.test(t))           return 'docs';
  if (/\b(refactor|rename|move|clean|reorgani)\b/.test(t)) return 'refactor';
  if (/\b(style|format|lint|prettier)\b/.test(t))         return 'style';
  if (/\b(ci|cd|pipeline|github|workflow)\b/.test(t))     return 'ci';
  if (/\b(remove|delete|revert|rollback)\b/.test(t))      return 'revert';
  return 'feat';
}
