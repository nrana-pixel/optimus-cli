import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { ChatApp } from '../ChatApp.js';
import { ThemeProvider } from '../Theme.js';
import { type FileDiff, type ToolRun, type UIMessage, getTextFromContent } from '../types.js';
import type { Toast } from '../Toasts.js';
import type { SessionListItem } from '../panels/SessionsPanel.js';
import type { GlobalSearchHit } from '../panels/SearchAllPanel.js';

import { readFileSync, existsSync } from 'fs';
import { ChatEngine } from '../../chat/chat-engine.js';
import { ConfigService } from '../../services/config.service.js';

/**
 * Ink UI Controller
 */
export function ChatUIController({ initialPrompt }: { initialPrompt?: string }) {
  const engineRef = useRef<ChatEngine | null>(null);
  const [initialPromptHandled, setInitialPromptHandled] = useState(false);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [tools, setTools] = useState<ToolRun[]>([]);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [diffGroups, setDiffGroups] = useState<Record<string, FileDiff[]>>({});
  const [snapshotGroups, setSnapshotGroups] = useState<Record<string, any[]>>({});
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [globalHits, setGlobalHits] = useState<GlobalSearchHit[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [branchParentId, setBranchParentId] = useState<string | null>(null);

  const [tokens, setTokens] = useState(0);
  const [cost, setCost] = useState(0);
  const [model, setModel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [themeName, setThemeName] = useState<'dark' | 'light' | 'high-contrast'>('dark');
  const [savedThreadRootId, setSavedThreadRootId] = useState<string | null>(null);
  const [savedThreadLeafId, setSavedThreadLeafId] = useState<string | null>(null);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [provider, setProvider] = useState<string>('unknown');
  const [branch, setBranch] = useState<string>('');
  const [cwd, setCwd] = useState<string>(process.cwd());
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [pendingPermission, setPendingPermission] = useState<{ calls: any[], previews?: FileDiff[], resolve: (v: import('../../chat/chat-engine.js').PermissionResult) => void } | null>(null);

  const tokenLimit = 128_000;

  const refreshSessions = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const list = engine.conv.listSessions();
    setSessions(list.map((s: any) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      messageCount: s.messages?.length ?? 0,
    })));
  }, []);

  const pushToast = useCallback((type: Toast['type'], message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, message }].slice(-5));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;
    const engine = new ChatEngine();
    engineRef.current = engine;
    await engine.initForInkUI({
      onState: (s: any) => {
        setTokens(s.tokens);
        setCost(s.cost);
        setModel(s.model);
        setSessionName(s.sessionName);
        setToolsEnabled(s.toolsEnabled);
        setPlanMode(s.planMode);
        if (s.provider) setProvider(s.provider);
      },
      onMessage: (m: UIMessage) => setMessages((prev) => {
        const idx = prev.findIndex(item => item.id === m.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = m;
          return next;
        }
        return [...prev, m];
      }),
      onPartialMessage: (m: UIMessage) => setMessages((prev) => {
        const idx = prev.findIndex(item => item.id === m.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], content: m.content };
          return next;
        }
        return [...prev, m];
      }),
      onTools: (t: ToolRun[]) => setTools(t),
      onDiffs: (d: FileDiff[]) => {
        setDiffs(d);
        const groups: Record<string, FileDiff[]> = {};
        for (const df of d) {
          const id = (df as any).toolRunId ?? 'unknown';
          groups[id] ??= [];
          groups[id].push(df);
        }
        setDiffGroups((prev) => ({ ...prev, ...groups }));
      },
      onSnapshots: (toolRunId: string, snapshots: any[]) => {
        setSnapshotGroups((prev) => ({ ...prev, [toolRunId]: snapshots }));
      },
      onPermissionRequest: (calls: any[], previews?: FileDiff[]) => new Promise<import('../../chat/chat-engine.js').PermissionResult>((resolve) => {
        setPendingPermission({ calls, previews, resolve });
      }),
    });

    try {
      const s = engine.conv.getCurrentSession();
      if (s) {
        s.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null, usage: {}, provider: 'unknown' };
        const t = s.settings.theme;
        if (t === 'dark' || t === 'light' || t === 'high-contrast') setThemeName(t);
        setSavedThreadRootId(s.settings.threadRootId ?? null);
        setSavedThreadLeafId(s.settings.threadLeafId ?? null);
        setRecentCommands(s.settings.recentCommands ?? []);
        setUsage(s.settings.usage ?? {});
        setProvider(s.settings.provider ?? 'unknown');
      }
    } catch { }

    await refreshSessions();

    try {
      const { GitService } = await import('../../services/git.service.js');
      const git = new GitService(process.cwd());
      if (await git.isGitRepo()) {
        const b = await git.getCurrentBranch();
        setBranch(b);
      }
    } catch { }

    return engine;
  }, [refreshSessions]);

  useEffect(() => {
    ensureEngine().catch((err) => {
      pushToast('error', err?.message ?? 'Startup failed');
    });
  }, [ensureEngine, pushToast]);

  const incUsage = useCallback(async (key: string) => {
    const engine = await ensureEngine();
    const session = engine.getCurrentSession();
    if (!session) return;
    session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null, usage: {} };
    session.settings.usage ??= {};
    session.settings.usage[key] = (session.settings.usage[key] ?? 0) + 1;
    setUsage({ ...session.settings.usage });
    engine.saveSession();
  }, [ensureEngine]);

  const archiveIfTooLarge = useCallback(async (cmd: any) => {
    const session = cmd?.conv.getCurrentSession();
    if (!session) return;
    if (session.messages.length < 5000) return;
    try {
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archived = session.messages.slice(0, 1000);
      const remaining = session.messages.slice(1000);
      const sessionsDir = cmd.conv.constructor.SESSIONS_DIR;
      const outPath = join(sessionsDir, `${session.id}.archive.${stamp}.json`);
      writeFileSync(outPath, JSON.stringify({ sessionId: session.id, archivedAt: new Date().toISOString(), messages: archived }, null, 2), 'utf-8');
      session.messages = remaining;
      cmd.conv.saveSession();
      setMessages((remaining ?? []).map((m: any) => ({
        id: m.id, role: m.role, content: m.content, timestamp: m.timestamp,
        pinned: m.pinned, reactions: m.reactions, editedAt: m.editedAt,
        parentMessageId: m.parentMessageId, tags: m.tags, provider: m.provider, model: m.model, tokensDelta: m.tokensDelta, costDelta: m.costDelta,
      })));
      pushToast('success', `Archived 1000 messages → ${outPath}`);
    } catch (e: any) { pushToast('error', e.message); }
  }, [pushToast]);

  const executePrompt = useCallback(async (text: string) => {
    const engine = await ensureEngine();
    try {
      setTools([]);
      setDiffs([]);
      setIsGenerating(true);
      if (text.startsWith('!')) {
        await incUsage('quick-exec');
        const cmd = text.slice(1).trim();
        if (!cmd) return;
        pushToast('info', `Running: ${cmd}`);
        try {
          const { execSync } = await import('child_process');
          const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
          engine.conv.addMessage('user', text);
          engine.conv.addMessage('assistant', `\`\`\`bash\n${output}\n\`\`\``);
        } catch (e: any) {
          engine.conv.addMessage('user', text);
          engine.conv.addMessage('assistant', `\`\`\`bash\nCommand failed: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}\n\`\`\``);
        }
        engine.saveSession();
        const s = engine.getCurrentSession();
        if (s) {
          setMessages((s.messages ?? []).map((m: any) => ({
            id: m.id, role: m.role,
            content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content,
            timestamp: m.timestamp, pinned: m.pinned, reactions: m.reactions,
            editedAt: m.editedAt, parentMessageId: m.parentMessageId, tags: m.tags,
            provider: m.provider, model: m.model, tokensDelta: m.tokensDelta, costDelta: m.costDelta
          })));
        }
        await refreshSessions();
        return;
      }

      if (text.startsWith('/compact')) {
        await incUsage('compact');
        pushToast('info', 'Compacting session...');
        try {
          await engine.handleInkLine('Please summarize our entire conversation so far into a concise technical document.');
          const s = engine.getCurrentSession();
          if (s) {
            const lastM = s.messages.pop();
            s.messages = lastM ? [lastM] : [];
            engine.saveSession();
            setMessages((s.messages ?? []).map((m: any) => ({
              id: m.id, role: m.role, content: m.content as any, timestamp: m.timestamp,
              pinned: m.pinned, reactions: m.reactions, editedAt: m.editedAt,
              parentMessageId: m.parentMessageId, tags: m.tags, provider: m.provider, model: m.model, tokensDelta: m.tokensDelta, costDelta: m.costDelta
            })));
          }
          pushToast('success', 'Compacted');
        } catch (e: any) { pushToast('error', e.message); }
        return;
      }

      if (text.startsWith('/review')) {
        await incUsage('review');
        pushToast('info', 'Reviewing diffs...');
        try {
          await engine.handleInkLine('Review the current git diff using git_diff.');
        } catch (e: any) { pushToast('error', e.message); }
        return;
      }

      if (branchParentId && !text.startsWith('/')) {
        engine.conv.addMessage('user', text, { parentMessageId: branchParentId });
        setBranchParentId(null);
        await engine.handleInkLine(text);
      } else {
        await engine.handleInkLine(text);
      }
    } catch (e: any) {
      pushToast('error', e?.message ?? 'Command failed');
    } finally {
      setIsGenerating(false);
      setTools([]);
    }
    await refreshSessions();
  }, [ensureEngine, refreshSessions, branchParentId, pushToast, incUsage]);

  const onSubmit = useCallback(async (text: string) => {
    if (isGenerating) {
      setQueue((prev) => [...prev, text]);
      pushToast('info', 'Message queued...');
      return;
    }
    const engine = await ensureEngine();
    await archiveIfTooLarge(engine as any);

    if (text.startsWith('/load-session ')) {
      const id = text.replace('/load-session', '').trim();
      const loaded = engine.loadSession(id);
      if (loaded) {
        setMessages((loaded.messages ?? []).map((m: any) => ({
          id: m.id, role: m.role, content: m.content as any, timestamp: m.timestamp,
          pinned: m.pinned, reactions: m.reactions, editedAt: m.editedAt,
          parentMessageId: m.parentMessageId, tags: m.tags, provider: m.provider, model: m.model, tokensDelta: m.tokensDelta, costDelta: m.costDelta
        })));
        setSessionName(loaded.name);
        await refreshSessions();
        pushToast('success', `Loaded: ${loaded.name}`);
      } else pushToast('error', 'Failed to load');
      return;
    }

    if (text.startsWith('/mode ')) {
      const mode = text.replace('/mode', '').trim().toLowerCase();
      try {
        ConfigService.updateConfig({ autonomyMode: mode as any });
        pushToast('success', `Mode: ${mode}`);
      } catch (e: any) { pushToast('error', e.message); }
      return;
    }

    if (text.startsWith('/search-all ')) {
      const q = text.replace('/search-all', '').trim().toLowerCase();
      const list = engine.conv.listSessions();
      const hits: GlobalSearchHit[] = [];
      for (const s of list) {
        for (const m of s.messages ?? []) {
          const content = getTextFromContent(m.content as any);
          if (content.toLowerCase().includes(q)) {
            hits.push({ sessionId: s.id, sessionName: s.name, messageId: m.id, preview: content.slice(0, 90) });
            if (hits.length >= 50) break;
          }
        }
        if (hits.length >= 50) break;
      }
      setGlobalHits(hits);
      pushToast('info', `Found ${hits.length} hits`);
      return;
    }

    if (text.startsWith('/recent-cmd')) {
      const cmdText = text.replace('/recent-cmd', '').trim();
      const session = engine.getCurrentSession();
      if (session) {
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null };
        const rc = session.settings.recentCommands || [];
        session.settings.recentCommands = [cmdText, ...rc.filter(x => x !== cmdText)].slice(0, 20);
        setRecentCommands(session.settings.recentCommands);
        engine.saveSession();
      }
      return;
    }

    // Auto-track other slash commands in history
    if (text.startsWith('/') && !text.startsWith('/load-session') && !text.startsWith('/search-all') && !text.startsWith('/mode')) {
      const session = engine.getCurrentSession();
      if (session) {
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null };
        const rc = session.settings.recentCommands || [];
        session.settings.recentCommands = [text, ...rc.filter(x => x !== text)].slice(0, 20);
        setRecentCommands(session.settings.recentCommands);
        engine.saveSession();
      }
    }

    await executePrompt(text);
  }, [ensureEngine, refreshSessions, pushToast, incUsage, isGenerating, executePrompt]);

  useEffect(() => {
    if (!isGenerating && queue.length > 0) {
      const next = queue[0];
      setQueue((prev) => prev.slice(1));
      executePrompt(next);
    }
  }, [isGenerating, queue, executePrompt]);

  useEffect(() => {
    if (initialPrompt && !initialPromptHandled && !isGenerating) {
      setInitialPromptHandled(true);
      onSubmit(initialPrompt);
    }
  }, [initialPrompt, initialPromptHandled, isGenerating, onSubmit]);

  const onRegenerateLast = useCallback(async () => {
    const engine = await ensureEngine();
    const session = engine.getCurrentSession();
    if (!session) return;
    const lastAIdx = [...session.messages].reverse().findIndex(m => m.role === 'assistant');
    if (lastAIdx < 0) return;
    session.messages.splice(session.messages.length - 1 - lastAIdx, 1);
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    pushToast('info', 'Regenerating…');
    try {
      setIsGenerating(true);
      await engine.handleInkLine(getTextFromContent(lastUser.content as any));
    } finally { setIsGenerating(false); }
  }, [ensureEngine, pushToast]);

  const onTogglePinLast = useCallback(async () => {
    const engine = await ensureEngine();
    await engine.togglePinLast();
  }, [ensureEngine]);

  const onReactLast = useCallback(async (reaction: 'up' | 'down') => {
    const engine = await ensureEngine();
    await engine.reactLast(reaction);
  }, [ensureEngine]);

  const onApproveTools = useCallback(() => { if (pendingPermission) { pendingPermission.resolve('yes'); setPendingPermission(null); } }, [pendingPermission]);
  const onDenyTools = useCallback(() => { if (pendingPermission) { pendingPermission.resolve('no'); setPendingPermission(null); } }, [pendingPermission]);
  const onAlwaysApprove = useCallback(() => { if (pendingPermission) { pendingPermission.resolve('always'); setPendingPermission(null); } }, [pendingPermission]);
  const onFeedbackTools = useCallback((text: string) => { if (pendingPermission) { pendingPermission.resolve({ type: 'feedback', text }); setPendingPermission(null); } }, [pendingPermission]);

  const getRuntimeState = useCallback(() => ({
    tokens, cost, toolsEnabled, planMode, tools, diffs, diffGroups, snapshotGroups, messages, sessions, globalHits, toasts, themeName, savedThreadRootId, savedThreadLeafId, recentCommands, usage, provider, isGenerating, pendingPermission, branch, cwd,
  }), [tokens, cost, toolsEnabled, planMode, tools, diffs, diffGroups, snapshotGroups, messages, sessions, globalHits, toasts, themeName, savedThreadRootId, savedThreadLeafId, recentCommands, usage, provider, isGenerating, pendingPermission, branch, cwd]);

  const ready = useMemo(() => Boolean(model), [model]);

  if (!ready) {
    return (
      <Box flexDirection="column">
        <Text>Starting Optimus UI…</Text>
        <Text dimColor>If this hangs, run `optimus init` to configure provider.</Text>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={themeName}>
      <ChatApp
        initialMessages={messages}
        model={model}
        sessionName={sessionName}
        tokenLimit={tokenLimit}
        compactMode={false}
        onSubmit={onSubmit}
        onRegenerateLast={onRegenerateLast}
        onTogglePinLast={onTogglePinLast}
        onReactLast={onReactLast}
        onApproveTools={onApproveTools}
        onDenyTools={onDenyTools}
        onAlwaysApprove={onAlwaysApprove}
        onFeedbackTools={onFeedbackTools}
        getRuntimeState={getRuntimeState}
      />
    </ThemeProvider>
  );
}
