export type Role = 'user' | 'assistant' | 'system';

export type ContentBlock =
  | { type: 'text', text: string }
  | { type: 'diff', path: string, diffText: string, language: string }
  | { type: 'permission-request', calls: any[], status?: 'pending' | 'approved' | 'denied', previewDiffs?: FileDiff[] };

export interface UIMessage {
  id: string;
  role: Role;
  content: ContentBlock[];
  timestamp: string;
  isPartial?: boolean;
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

export function getTextFromContent(content: UIMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  return content.map(block => block.type === 'text' ? block.text : '').join('\n');
}
