/**
 * Conversation Service
 * Manages conversation history and session persistence
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export type MessageReaction = 'up' | 'down';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | any[];
  timestamp: string;

  // Enhanced UI metadata (optional for backward compatibility)
  reactions?: MessageReaction[];
  pinned?: boolean;
  editedAt?: string;
  parentMessageId?: string; // enables simple branching
  tags?: string[];

  // Analytics metadata (optional)
  provider?: string;
  model?: string;
  tokensDelta?: number;
  costDelta?: number;
}

export interface ConversationSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  metadata: {
    provider: string;
    model: string;
    totalTokens: number;
    totalCost: number;
  };

  // Persisted UI settings
  settings?: {
    theme?: 'sun' | 'moon' | 'universe';
    compactMode?: boolean;
    showLineNumbers?: boolean;
    // Ink UI persisted state
    recentCommands?: string[];
    threadRootId?: string | null;
    threadLeafId?: string | null;
    usage?: Record<string, number>;
    provider?: string;
  };
}


export class ConversationService {
  private static readonly SESSIONS_DIR = join(homedir(), '.multi-agent', 'sessions');
  private currentSession: ConversationSession | null = null;

  constructor() {
    this.ensureSessionsDirectory();
  }

  /** Backward-compatible migration for older session JSON formats */
  private _migrateSessionInPlace(session: ConversationSession) {
    // Ensure settings exists
    session.settings ??= { theme: 'moon', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null, usage: {}, provider: 'unknown' };
    session.settings.recentCommands ??= [];
    if (session.settings.threadRootId === undefined) session.settings.threadRootId = null;
    if (session.settings.threadLeafId === undefined) session.settings.threadLeafId = null;
    (session.settings as any).usage ??= {};
    (session.settings as any).provider ??= 'unknown';

    // Ensure message IDs
    for (const m of session.messages as any[]) {
      if (!m.id) m.id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      if (!m.timestamp) m.timestamp = new Date().toISOString();
    }
  }

  /**
   * Ensure sessions directory exists
   */
  private ensureSessionsDirectory(): void {
    if (!existsSync(ConversationService.SESSIONS_DIR)) {
      mkdirSync(ConversationService.SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Create a new conversation session
   */
  createSession(name: string, provider: string, model: string): ConversationSession {
    const id = this.generateSessionId();
    const now = new Date().toISOString();

    this.currentSession = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {
        provider,
        model,
        totalTokens: 0,
        totalCost: 0,
      },
    };

    return this.currentSession;
  }

  /**
   * Load an existing session
   */
  loadSession(sessionId: string): ConversationSession | null {
    try {
      const filePath = join(ConversationService.SESSIONS_DIR, `${sessionId}.json`);
      if (!existsSync(filePath)) {
        return null;
      }

      const content = readFileSync(filePath, 'utf-8');
      this.currentSession = JSON.parse(content) as ConversationSession;
      this._migrateSessionInPlace(this.currentSession);
      return this.currentSession;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the last session
   */
  getLastSession(): ConversationSession | null {
    try {
      const files = readdirSync(ConversationService.SESSIONS_DIR);
      if (files.length === 0) {
        return null;
      }

      // Sort by modification time, get the most recent
      const sessions = files
        .map((file: string) => {
          const filePath = join(ConversationService.SESSIONS_DIR, file);
          const stats = statSync(filePath);
          return { file, time: stats.mtimeMs };
        })
        .sort((a: any, b: any) => b.time - a.time);

      if (sessions.length === 0) {
        return null;
      }

      const sessionId = sessions[0].file.replace('.json', '');
      return this.loadSession(sessionId);
    } catch (error) {
      return null;
    }
  }

  /**
   * Add a message to the current session
   */
  addMessage(role: 'user' | 'assistant' | 'system', content: string | any[], opts?: Partial<Omit<Message, 'role' | 'content' | 'timestamp'>>): Message {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const message: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      provider: this.currentSession.metadata.provider,
      model: this.currentSession.metadata.model,
      ...opts,
    };

    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = new Date().toISOString();

    return message;
  }

  /**
   * Update an existing message
   */
  updateMessage(id: string, updates: Partial<Omit<Message, 'id'>>): boolean {
    if (!this.currentSession) return false;
    const idx = this.currentSession.messages.findIndex(m => m.id === id);
    if (idx === -1) return false;
    this.currentSession.messages[idx] = { ...this.currentSession.messages[idx], ...updates };
    this.currentSession.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Update session metadata
   */
  updateMetadata(tokens: number, cost: number): void {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.metadata.totalTokens += tokens;
    this.currentSession.metadata.totalCost += cost;
    this.currentSession.updatedAt = new Date().toISOString();
  }

  /**
   * Get conversation context for LLM
   */
  getConversationContext(): string {
    if (!this.currentSession || this.currentSession.messages.length === 0) {
      return '';
    }

    return this.currentSession.messages
      .map((msg) => {
        const text = Array.isArray(msg.content)
          ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : msg.content;
        return `${msg.role.toUpperCase()}: ${text}`;
      })
      .join('\n\n');
  }

  /**
   * Get messages for LLM context (last N messages)
   */
  getContextMessages(limit: number = 10): Array<{ role: string; content: string | any[] }> {
    if (!this.currentSession) {
      return [];
    }

    const messages = this.currentSession.messages.slice(-limit);
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Save current session to disk
   */
  saveSession(): void {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const filePath = join(ConversationService.SESSIONS_DIR, `${this.currentSession.id}.json`);
    writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2), 'utf-8');
  }

  /**
   * Get current session
   */
  getCurrentSession(): ConversationSession | null {
    return this.currentSession;
  }

  /**
   * List all sessions
   */
  listSessions(): ConversationSession[] {
    try {
      const files = readdirSync(ConversationService.SESSIONS_DIR);
      const sessions: ConversationSession[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = join(ConversationService.SESSIONS_DIR, file);
            const content = readFileSync(filePath, 'utf-8');
            const session = JSON.parse(content) as ConversationSession;
            if (session) {
              sessions.push(session);
            }
          } catch {
            // Skip corrupt session files
          }
        }
      }

      // Sort by updatedAt, most recent first
      return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    try {
      const filePath = join(ConversationService.SESSIONS_DIR, `${sessionId}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clear current session
   */
  clearSession(): void {
    this.currentSession = null;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    // Prefer UUIDs to avoid collisions and deprecated string APIs.
    try {
      return `session-${randomUUID()}`;
    } catch {
      return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
  }

  /**
   * Get session summary
   */
  getSessionSummary(): string {
    if (!this.currentSession) {
      return '';
    }

    const { id, name, createdAt, messages, metadata } = this.currentSession;
    const messageCount = messages.length;
    const userMessages = messages.filter((m) => m.role === 'user').length;
    const assistantMessages = messages.filter((m) => m.role === 'assistant').length;

    return `
Session: ${name} (${id})
Created: ${new Date(createdAt).toLocaleString()}
Messages: ${messageCount} (${userMessages} user, ${assistantMessages} assistant)
Provider: ${metadata.provider}
Model: ${metadata.model}
Total Tokens: ${metadata.totalTokens}
Total Cost: $${metadata.totalCost.toFixed(6)}
    `.trim();
  }
}
