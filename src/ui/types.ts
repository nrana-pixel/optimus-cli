export type Role = 'user' | 'assistant' | 'system';

export interface UIMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  pinned?: boolean;
  reactions?: Array<'up' | 'down'>;
  editedAt?: string;
  parentMessageId?: string;
  tags?: string[];
  provider?: string;
  model?: string;
  tokensDelta?: number;
  costDelta?: number;
}

export interface ToolRun {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'success' | 'error';
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface FileDiff {
  path: string;
  diffText: string;
  insertions: number;
  deletions: number;
  toolRunId?: string;
}
