import { spawn, ChildProcess } from 'child_process';
import { truncateMiddle } from '../utils/truncate.js';

export interface ExecSession {
  id: string;
  process: ChildProcess;
  output: string;
  isAlive: boolean;
  workdir: string;
}

/**
 * Unified Exec Service
 * Manages interactive processes allowing the AI to provide stdin to commands.
 * Following the Codex pattern for persistent shell interactions.
 */
export class UnifiedExecService {
  private sessions: Map<string, ExecSession> = new Map();

  async spawn(cmd: string, args: string[], workdir: string): Promise<string> {
    const id = `exec_${Date.now()}`;
    const proc = spawn(cmd, args, {
      cwd: workdir,
      shell: true,
      env: process.env
    });

    const session: ExecSession = {
      id,
      process: proc,
      output: '',
      isAlive: true,
      workdir
    };

    this.sessions.set(id, session);

    return new Promise((resolve) => {
      let resolved = false;

      const handleOutput = (data: any) => {
        session.output += data.toString();
        // If we see a likely prompt or a lot of output, we might want to return early to let AI respond
        if (session.output.length > 2000 && !resolved) {
          resolved = true;
          resolve(this.formatResponse(session));
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('exit', (code) => {
        session.isAlive = false;
        if (!resolved) {
          resolved = true;
          resolve(this.formatResponse(session));
        }
      });

      // Timeout if nothing happens
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(this.formatResponse(session));
        }
      }, 5000);
    });
  }

  async writeStdin(id: string, text: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session || !session.isAlive) {
      return `Error: Session ${id} not found or already finished.`;
    }

    session.output = ''; // clear for new turn
    session.process.stdin?.write(text + '\n');

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.formatResponse(session));
      }, 2000);
    });
  }

  private formatResponse(session: ExecSession): string {
    const truncated = truncateMiddle(session.output, { maxChars: 5000 });
    return `[Process ID: ${session.id}]
[Status: ${session.isAlive ? 'RUNNING - Waiting for input...' : 'FINISHED'}]

Output:
${truncated}`;
  }

  getAliveSessions() {
    return Array.from(this.sessions.values()).filter(s => s.isAlive);
  }
}
