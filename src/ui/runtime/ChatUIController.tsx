import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { ChatApp } from '../ChatApp.js';
import { ThemeProvider } from '../Theme.js';
import type { FileDiff, ToolRun, UIMessage } from '../types.js';
import type { Toast } from '../Toasts.js';
import type { SessionListItem } from '../panels/SessionsPanel.js';
import type { GlobalSearchHit } from '../panels/SearchAllPanel.js';

import ChatCommand from '../../commands/chat.js';
import { ConfigService } from '../../services/config.service.js';

/**
 * Ink UI Controller
 *
 * To avoid duplicating all agent logic, we reuse the existing Chat command as an engine.
 * We instantiate it and call internal methods through a small adapter.
 *
 * This is intentionally pragmatic: we keep a single source of truth for agent orchestration.
 */
export function ChatUIController() {
  const engineRef = useRef<ChatCommand | null>(null);

  // UI state mirrors engine runtime state
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
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const tokenLimit = 128_000;

  const refreshSessions = useCallback(async () => {
    const cmd = engineRef.current;
    if (!cmd) return;
    const list = (cmd as any).conv.listSessions();
    setSessions(list.map((s: any) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      messageCount: s.messages?.length ?? 0,
    })));
  }, []);

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;

    // Instantiate Chat command engine.
    // NOTE: oclif normally constructs commands. Here we create a minimal instance.
    const cmd = new (ChatCommand as any)([], {});
    engineRef.current = cmd;

    // Run initialization but do not start its legacy prompt loop.
    // We call a new helper on the command (added in this branch) that initializes services.
    await (cmd as any)._initForInkUI({
      onState: (s: any) => {
        setTokens(s.tokens);
        setCost(s.cost);
        setModel(s.model);
        setSessionName(s.sessionName);
        setToolsEnabled(s.toolsEnabled);
        setPlanMode(s.planMode);
      },
      onMessage: (m: UIMessage) => setMessages((prev) => [...prev, m]),
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
    });

    // apply persisted theme/provider (if any)
    try {
      const s = (cmd as any).conv.getCurrentSession();
      // persist provider per session
      let cfgProvider = 'unknown';
      try {
        const cfg = ConfigService.loadConfig();
        cfgProvider = String(cfg.apiProvider ?? 'unknown');
      } catch { }
      s.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null, usage: {}, provider: cfgProvider };
      if (!s.settings.provider || s.settings.provider === 'unknown') s.settings.provider = cfgProvider;
      setProvider(s.settings.provider ?? 'unknown');
      (cmd as any).conv.saveSession();
      const t = s?.settings?.theme;
      if (t === 'dark' || t === 'light' || t === 'high-contrast') setThemeName(t);
      const tr = (s?.settings as any)?.threadRootId;
      if (typeof tr === 'string' || tr === null) setSavedThreadRootId(tr ?? null);
      const tl = (s?.settings as any)?.threadLeafId;
      if (typeof tl === 'string' || tl === null) setSavedThreadLeafId(tl ?? null);

      // validate: leaf must be reachable from root
      if (tr && tl) {
        const byId = new Map((s?.messages ?? []).map((m: any) => [m.id, m]));
        let cur: any = byId.get(tl);
        let ok = false;
        while (cur) {
          if (cur.id === tr) { ok = true; break; }
          cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined;
        }
        if (!ok) {
          setSavedThreadLeafId(null);
          (s.settings as any).threadLeafId = null;
          (cmd as any).conv.saveSession();
        }
      }
      const rc = (s?.settings as any)?.recentCommands;
      if (Array.isArray(rc)) setRecentCommands(rc.slice(0, 20));
      const u = (s?.settings as any)?.usage;
      if (u && typeof u === 'object') setUsage(u);
      const pr = (s?.settings as any)?.provider;
      if (typeof pr === 'string') setProvider(pr);
    } catch { }

    await refreshSessions();

    return cmd;
  }, []);

  useEffect(() => {
    ensureEngine().catch((err) => {
      pushToast('error', err?.message ?? 'Startup failed');
    });
  }, [ensureEngine]);

  const pushToast = useCallback((type: Toast['type'], message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, message }].slice(-5));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  const incUsage = useCallback(async (key: string) => {
    const cmd = await ensureEngine();
    const session = (cmd as any).conv.getCurrentSession();
    if (!session) return;
    session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null, usage: {} };
    (session.settings as any).usage ??= {};
    (session.settings as any).usage[key] = ((session.settings as any).usage[key] ?? 0) + 1;
    setUsage({ ...(session.settings as any).usage });
    (cmd as any).conv.saveSession();
  }, [ensureEngine]);

  const archiveIfTooLarge = useCallback(async (cmd: any) => {
    const session = cmd?.conv.getCurrentSession();
    if (!session) return;

    const WARN_AT = 2000;
    const HARD_CAP = 5000;
    if (session.messages.length < WARN_AT) return;

    if (session.messages.length >= WARN_AT && session.messages.length < HARD_CAP) {
      pushToast('warn', `Large session: ${session.messages.length} messages`);
      return;
    }

    // Archive oldest messages to a JSON file, then trim
    try {
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveCount = session.messages.length - (HARD_CAP - 500);
      const archived = session.messages.slice(0, Math.max(0, archiveCount));
      const remaining = session.messages.slice(archived.length);

      const sessionsDir = cmd.conv.constructor.SESSIONS_DIR;
      const outPath = join(sessionsDir, `${session.id}.archive.${stamp}.json`);
      writeFileSync(outPath, JSON.stringify({
        sessionId: session.id,
        sessionName: session.name,
        archivedAt: new Date().toISOString(),
        messages: archived,
      }, null, 2), 'utf-8');

      session.messages = remaining;
      cmd.conv.saveSession();

      // refresh UI messages as well
      setMessages((remaining ?? []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
          : String(m.content),
        timestamp: m.timestamp,
        pinned: m.pinned,
        reactions: m.reactions,
        editedAt: m.editedAt,
        parentMessageId: m.parentMessageId,
        tags: m.tags,
        provider: m.provider,
        model: m.model,
        tokensDelta: m.tokensDelta,
        costDelta: m.costDelta,
      })));

      pushToast('success', `Archived ${archived.length} messages → ${outPath}`);
    } catch (e: any) {
      pushToast('error', e?.message ?? 'Archiving failed');
    }
  }, [pushToast]);

  const onSubmit = useCallback(async (text: string) => {
    const cmd = await ensureEngine();
    await archiveIfTooLarge(cmd);

    // UI-level commands handled here
    if (text.startsWith('/load-session ')) {
      const id = text.replace('/load-session', '').trim();
      const loaded = (cmd as any).conv.loadSession(id);
      if (loaded) {
        // Reset UI state to loaded session
        setMessages((loaded.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : String(m.content),
          timestamp: m.timestamp,
          pinned: m.pinned,
          reactions: m.reactions,
          editedAt: m.editedAt,
          parentMessageId: m.parentMessageId,
          tags: m.tags,
          provider: m.provider,
          model: m.model,
          tokensDelta: m.tokensDelta,
          costDelta: m.costDelta,
        })));
        setSessionName(loaded.name);
        const t = loaded.settings?.theme;
        if (t === 'dark' || t === 'light' || t === 'high-contrast') setThemeName(t);
        const tr = (loaded.settings as any)?.threadRootId;
        if (typeof tr === 'string' || tr === null) setSavedThreadRootId(tr ?? null);
        const tl = (loaded.settings as any)?.threadLeafId;
        if (typeof tl === 'string' || tl === null) setSavedThreadLeafId(tl ?? null);

        // validate: leaf must be reachable from root
        if (tr && tl) {
          const byId = new Map((loaded.messages ?? []).map((m: any) => [m.id, m]));
          let cur: any = byId.get(tl);
          let ok = false;
          while (cur) {
            if (cur.id === tr) { ok = true; break; }
            cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined;
          }
          if (!ok) {
            setSavedThreadLeafId(null);
            (loaded.settings as any).threadLeafId = null;
            (cmd as any).conv.saveSession();
          }
        }
        const rc = (loaded.settings as any)?.recentCommands;
        if (Array.isArray(rc)) setRecentCommands(rc.slice(0, 20));
        const u = (loaded.settings as any)?.usage;
        if (u && typeof u === 'object') setUsage(u);
        const pr = (loaded.settings as any)?.provider;
        if (typeof pr === 'string') setProvider(pr);
        pushToast('success', `Loaded session: ${loaded.name}`);
      } else {
        pushToast('error', `Failed to load session: ${id}`);
      }
      await refreshSessions();
      return;
    }

    if (text.startsWith('/delete-session ')) {
      const id = text.replace('/delete-session', '').trim();
      const ok = (cmd as any).conv.deleteSession(id);
      pushToast(ok ? 'success' : 'error', ok ? 'Session deleted' : 'Delete failed');
      await refreshSessions();
      return;
    }

    if (text.startsWith('/tag-msg ')) {
      await incUsage('tag-msg');
      const rest = text.replace('/tag-msg', '').trim();
      const firstSpace = rest.indexOf(' ');
      const messageId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
      const raw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
      let tag = raw;
      try { tag = JSON.parse(raw); } catch { }

      const session = (cmd as any).conv.getCurrentSession();
      const msg = session?.messages.find((m: any) => m.id === messageId);
      if (!session || !msg) { pushToast('error', 'Message not found'); return; }
      msg.tags ??= [];
      if (!msg.tags.includes(tag)) msg.tags.push(tag);
      (cmd as any).conv.saveSession();
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, tags: msg.tags } : m)));
      pushToast('success', `Tagged: ${tag}`);
      return;
    }

    if (text.startsWith('/untag-msg ')) {
      await incUsage('untag-msg');
      const rest = text.replace('/untag-msg', '').trim();
      const firstSpace = rest.indexOf(' ');
      const messageId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
      const raw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
      let tag = raw;
      try { tag = JSON.parse(raw); } catch { }

      const session = (cmd as any).conv.getCurrentSession();
      const msg = session?.messages.find((m: any) => m.id === messageId);
      if (!session || !msg) { pushToast('error', 'Message not found'); return; }
      msg.tags = (msg.tags ?? []).filter((t: string) => t !== tag);
      (cmd as any).conv.saveSession();
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, tags: msg.tags } : m)));
      pushToast('success', `Removed tag: ${tag}`);
      return;
    }

    if (text.startsWith('/prune-branch ')) {
      await incUsage('prune-branch');
      const leafId = text.replace('/prune-branch', '').trim();
      const session = (cmd as any).conv.getCurrentSession();
      if (!session) return;

      const byId = new Map<string, any>(session.messages.map((m: any) => [m.id, m]));
      const toDelete = new Set<string>();
      let cur: any = byId.get(leafId);
      while (cur) {
        toDelete.add(cur.id);
        cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined;
      }

      const before = session.messages.length;
      session.messages = session.messages.filter((m: any) => !toDelete.has(m.id));
      // clear thread selection if it pointed into pruned set
      if ((session.settings as any)?.threadLeafId && toDelete.has((session.settings as any).threadLeafId)) {
        (session.settings as any).threadLeafId = null;
        setSavedThreadLeafId(null);
      }
      if ((session.settings as any)?.threadRootId && toDelete.has((session.settings as any).threadRootId)) {
        (session.settings as any).threadRootId = null;
        (session.settings as any).threadLeafId = null;
        setSavedThreadRootId(null);
        setSavedThreadLeafId(null);
      }
      (cmd as any).conv.saveSession();
      setMessages((prev) => prev.filter((m) => !toDelete.has(m.id)));

      pushToast('success', `Pruned ${before - session.messages.length} message(s)`);
      return;
    }

    if (text.startsWith('/delete-msg ')) {
      await incUsage('delete-msg');
      const messageId = text.replace('/delete-msg', '').trim();
      const session = (cmd as any).conv.getCurrentSession();
      if (!session) return;
      const before = session.messages.length;
      session.messages = session.messages.filter((m: any) => m.id !== messageId);
      // clear thread selection if it pointed to deleted message
      if ((session.settings as any)?.threadLeafId === messageId) (session.settings as any).threadLeafId = null;
      if ((session.settings as any)?.threadRootId === messageId) {
        (session.settings as any).threadRootId = null;
        (session.settings as any).threadLeafId = null;
      }
      (cmd as any).conv.saveSession();
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      if (savedThreadLeafId === messageId) setSavedThreadLeafId(null);
      if (savedThreadRootId === messageId) {
        setSavedThreadRootId(null);
        setSavedThreadLeafId(null);
      }
      pushToast('success', before !== session.messages.length ? 'Message deleted' : 'Message not found');
      return;
    }

    if (text.startsWith('/edit-asst ')) {
      await incUsage('edit-asst');
      const rest = text.replace('/edit-asst', '').trim();
      const firstSpace = rest.indexOf(' ');
      const messageId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
      const raw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
      let newContent = raw;
      try { newContent = JSON.parse(raw); } catch { }

      const session = (cmd as any).conv.getCurrentSession();
      const msg = session?.messages.find((m: any) => m.id === messageId);
      if (!session || !msg) { pushToast('error', 'Message not found'); return; }
      if (msg.role !== 'assistant') { pushToast('warn', 'Not an assistant message'); return; }
      msg.content = newContent;
      msg.editedAt = new Date().toISOString();
      (cmd as any).conv.saveSession();
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: String(newContent), editedAt: msg.editedAt } : m)));
      pushToast('success', 'Assistant message edited');
      return;
    }

    if (text.startsWith('/edit-branch ')) {
      await incUsage('edit-branch');
      // Format: /edit-branch <messageId> <jsonContent>
      const rest = text.replace('/edit-branch', '').trim();
      const firstSpace = rest.indexOf(' ');
      const messageId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
      const raw = firstSpace === -1 ? '' : rest.slice(firstSpace + 1).trim();
      let newContent = raw;
      try { newContent = JSON.parse(raw); } catch { }

      const session = (cmd as any).conv.getCurrentSession();
      if (!session) return;

      const msg = session.messages.find((m: any) => m.id === messageId);
      if (!msg) {
        pushToast('error', 'Message not found');
        return;
      }

      msg.content = newContent;
      msg.editedAt = new Date().toISOString();
      (cmd as any).conv.saveSession();

      // Update UI message content
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: String(newContent), editedAt: msg.editedAt } : m)));

      // Start branch from this message
      setBranchParentId(messageId);

      // Re-run using edited message content as next prompt if it's a user message
      if (msg.role === 'user' && typeof newContent === 'string') {
        pushToast('info', 'Re-running edited message as new branch…');
        await (cmd as any)._handleInkLine(newContent);
        await refreshSessions();
        pushToast('success', 'Branched re-run complete');
      } else {
        pushToast('warn', 'Edited message is not a user prompt; branch will apply to your next message');
      }
      return;
    }

    if (text.startsWith('/edit-last ')) {
      await incUsage('edit-last');
      // edit last user message content in session and rerun
      const raw = text.replace('/edit-last', '').trim();
      let newPrompt = raw;
      try { newPrompt = JSON.parse(raw); } catch { }

      const session = (cmd as any).conv.getCurrentSession();
      if (session) {
        const idx = [...session.messages].reverse().findIndex((m: any) => m.role === 'user');
        if (idx >= 0) {
          const realIdx = session.messages.length - 1 - idx;
          session.messages[realIdx].content = newPrompt;
          session.messages[realIdx].editedAt = new Date().toISOString();
          (cmd as any).conv.saveSession();

          // Also update engine msgs list (best-effort): replace last user in cmd.msgs
          const mIdx = [...(cmd as any).msgs].reverse().findIndex((m: any) => m.role === 'user');
          if (mIdx >= 0) {
            const ridx = (cmd as any).msgs.length - 1 - mIdx;
            (cmd as any).msgs[ridx].content = newPrompt;
          }

          // rerun
          await (cmd as any)._handleInkLine(newPrompt);
          pushToast('success', 'Re-ran edited prompt');
        }
      }

      await refreshSessions();
      return;
    }

    if (text.startsWith('/accept-run ')) {
      await incUsage('accept-run');
      const runId = text.replace('/accept-run', '').trim();
      setDiffGroups((prev) => {
        const copy = { ...prev };
        delete copy[runId];
        return copy;
      });
      setDiffs((prev) => prev.filter((d: any) => (d.toolRunId ?? 'unknown') !== runId));
      pushToast('success', `Accepted run ${runId}`);
      return;
    }

    if (text.startsWith('/revert-run ')) {
      await incUsage('revert-run');
      const runId = text.replace('/revert-run', '').trim();
      const snaps = snapshotGroups[runId];
      if (!snaps || snaps.length === 0) {
        pushToast('warn', 'No snapshots for that run');
        return;
      }
      try {
        const { writeFileSync, existsSync, unlinkSync } = await import('fs');
        for (const snap of snaps as any[]) {
          if (snap.existed && snap.content !== null) {
            writeFileSync(snap.absPath, snap.content, 'utf-8');
          } else if (!snap.existed && existsSync(snap.absPath)) {
            unlinkSync(snap.absPath);
          }
        }
        // remove diffs for this run
        setDiffGroups((prev) => {
          const copy = { ...prev };
          delete copy[runId];
          return copy;
        });
        setDiffs((prev) => prev.filter((d: any) => (d.toolRunId ?? 'unknown') !== runId));
        pushToast('success', `Reverted run ${runId}`);
      } catch (e: any) {
        pushToast('error', e?.message ?? 'Revert run failed');
      }
      return;
    }

    if (text.startsWith('/accept-diffs')) {
      await incUsage('accept-diffs');
      setDiffs([]);
      pushToast('success', 'Diffs accepted');
      return;
    }

    if (text.startsWith('/export-ui ')) {
      await incUsage('export');
      const rest = text.replace('/export-ui', '').trim().split(' ');
      const format = rest[0] as 'md' | 'json' | undefined;
      const outPath = rest.slice(1).join(' ').trim();
      const session = (cmd as any).conv.getCurrentSession();
      if (!format || !outPath || !session) {
        pushToast('error', 'Export usage: /export-ui <md|json> <path>');
        return;
      }

      try {
        const { writeFileSync } = await import('fs');
        if (format === 'json') {
          writeFileSync(outPath, JSON.stringify(session, null, 2), 'utf-8');
        } else {
          const lines: string[] = [];
          lines.push(`# ${session.name}`);
          lines.push('');
          for (const m of session.messages) {
            const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Optimus' : 'System';
            lines.push(`## ${who}`);
            lines.push('');
            const txt = Array.isArray(m.content)
              ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
              : String(m.content);
            lines.push(txt);
            lines.push('');
          }
          writeFileSync(outPath, lines.join('\n'), 'utf-8');
        }
        pushToast('success', `Exported: ${outPath}`);
      } catch (e: any) {
        pushToast('error', e?.message ?? 'Export failed');
      }
      return;
    }

    if (text.startsWith('/import ')) {
      await incUsage('import');
      const filePath = text.replace('/import', '').trim();
      try {
        const { readFileSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const raw = readFileSync(filePath, 'utf-8');
        const session = JSON.parse(raw);
        if (!session || !session.id || !Array.isArray(session.messages)) {
          pushToast('error', 'Invalid session JSON');
          return;
        }

        // Save into sessions directory (same path as ConversationService uses)
        const sessionsDir = (cmd as any).conv.constructor.SESSIONS_DIR;
        const outPath = join(sessionsDir, `${session.id}.json`);
        writeFileSync(outPath, JSON.stringify(session, null, 2), 'utf-8');

        // Load it
        const loaded = (cmd as any).conv.loadSession(session.id);
        if (loaded) {
          setMessages((loaded.messages ?? []).map((m: any) => ({
            id: m.id,
            role: m.role,
            content: Array.isArray(m.content)
              ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
              : String(m.content),
            timestamp: m.timestamp,
            pinned: m.pinned,
            reactions: m.reactions,
            editedAt: m.editedAt,
            parentMessageId: m.parentMessageId,
            tags: m.tags,
            provider: m.provider,
            model: m.model,
            tokensDelta: m.tokensDelta,
            costDelta: m.costDelta,
          })));
          setSessionName(loaded.name);
          pushToast('success', 'Session imported');
        }
        await refreshSessions();
      } catch (e: any) {
        pushToast('error', e?.message ?? 'Import failed');
      }
      return;
    }

    if (text.startsWith('/revert-all')) {
      await incUsage('revert-all');
      const tools = (cmd as any).lastTools;
      if (tools && tools.snapshots && tools.snapshots.length > 0) {
        tools.undoAll();
        pushToast('success', 'Reverted all changes');
      } else {
        pushToast('warn', 'Nothing to revert');
      }
      await refreshSessions();
      return;
    }

    if (text.startsWith('/revert-file ')) {
      await incUsage('revert-file');
      const rel = text.replace('/revert-file', '').trim();
      const tools = (cmd as any).lastTools;
      const snaps = tools?.snapshots ?? [];
      const snap = snaps.find((s: any) => s.relPath.replace(/\\/g, '/') === rel.replace(/\\/g, '/'));
      if (!snap) {
        pushToast('warn', `No snapshot for ${rel}`);
        return;
      }
      try {
        const { writeFileSync, existsSync, unlinkSync } = await import('fs');
        if (snap.existed && snap.content !== null) {
          writeFileSync(snap.absPath, snap.content, 'utf-8');
        } else if (!snap.existed && existsSync(snap.absPath)) {
          unlinkSync(snap.absPath);
        }
        pushToast('success', `Reverted ${rel}`);
      } catch (e: any) {
        pushToast('error', e?.message ?? 'Revert failed');
      }
      return;
    }

    if (text.startsWith('/recent-cmd')) {
      await incUsage('palette-select');
      const raw = text.replace('/recent-cmd', '').trim();
      const cmdText = raw;
      const session = (cmd as any).conv.getCurrentSession();
      if (session) {
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null };
        session.settings.recentCommands ??= [];
        if (cmdText) {
          session.settings.recentCommands = [cmdText, ...session.settings.recentCommands.filter((x: string) => x !== cmdText)].slice(0, 20);
          setRecentCommands(session.settings.recentCommands);
          (cmd as any).conv.saveSession();
        }
      }
      return;
    }

    if (text.startsWith('/thread-leaf')) {
      const raw = text.replace('/thread-leaf', '').trim();
      const session = (cmd as any).conv.getCurrentSession();
      if (session) {
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null };
        (session.settings as any).threadLeafId = raw || null;
        (cmd as any).conv.saveSession();
        setSavedThreadLeafId(raw || null);
        pushToast('success', raw ? 'Branch leaf selected' : 'Leaf cleared');
      }
      return;
    }

    if (text.startsWith('/thread-root')) {
      const raw = text.replace('/thread-root', '').trim();
      const session = (cmd as any).conv.getCurrentSession();
      if (session) {
        session.settings ??= { theme: 'dark', compactMode: false, showLineNumbers: false, recentCommands: [], threadRootId: null, threadLeafId: null };
        (session.settings as any).threadRootId = raw || null;
        (session.settings as any).threadLeafId = null;
        setSavedThreadRootId(raw || null);
        setSavedThreadLeafId(null);
        (cmd as any).conv.saveSession();
        pushToast('success', raw ? 'Thread selected' : 'Thread cleared');
      }
      return;
    }

    if (text.startsWith('/branch ')) {
      await incUsage('branch');
      const parentId = text.replace('/branch', '').trim();
      setBranchParentId(parentId || null);
      pushToast('info', 'Branch started. Your next message will be attached to the selected parent.');
      return;
    }

    if (text.startsWith('/search-all ')) {
      await incUsage('search-all');
      const raw = text.replace('/search-all', '').trim();
      let q = raw;
      try { q = JSON.parse(raw); } catch { }

      const query = String(q).trim().toLowerCase();
      const list = (cmd as any).conv.listSessions();
      const hits: GlobalSearchHit[] = [];
      for (const s of list) {
        for (const m of s.messages ?? []) {
          const content = Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : String(m.content);
          if (content.toLowerCase().includes(query)) {
            hits.push({
              sessionId: s.id,
              sessionName: s.name,
              messageId: m.id,
              preview: content.replace(/\n/g, ' ').slice(0, 90),
            });
            if (hits.length >= 50) break;
          }
        }
        if (hits.length >= 50) break;
      }
      setGlobalHits(hits);
      pushToast('info', `Found ${hits.length} hit(s)`);
      return;
    }

    try {
      setIsGenerating(true);
      // If we're in a branch, attach parentMessageId to the next user message at persistence level.
      if (branchParentId && !text.startsWith('/')) {
        // Add user message with parentMessageId to session + engine
        (cmd as any).msgs.push({ role: 'user', content: text });
        (cmd as any).conv.addMessage('user', text, { parentMessageId: branchParentId });
        // Clear branch parent once used
        setBranchParentId(null);
        await (cmd as any)._handleInkLine(text);
      } else {
        await (cmd as any)._handleInkLine(text);
      }
    } catch (e: any) {
      pushToast('error', e?.message ?? 'Command failed');
    } finally {
      setIsGenerating(false);
    }
    await refreshSessions();
  }, [ensureEngine, refreshSessions]);

  const onRegenerateLast = useCallback(async () => {
    const cmd = await ensureEngine();
    const session = (cmd as any).conv.getCurrentSession();
    if (!session) return;

    // Find last assistant message and last user message
    const lastAssistantIdx = [...session.messages].reverse().findIndex((m: any) => m.role === 'assistant');
    const lastUser = [...session.messages].reverse().find((m: any) => m.role === 'user');
    if (lastAssistantIdx < 0 || !lastUser) return;

    // Remove the last assistant message from persisted session
    const realAIdx = session.messages.length - 1 - lastAssistantIdx;
    session.messages.splice(realAIdx, 1);
    (cmd as any).conv.saveSession();

    // Also remove last assistant from UI messages
    setMessages((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
      if (idx < 0) return prev;
      const ridx = prev.length - 1 - idx;
      const copy = [...prev];
      copy.splice(ridx, 1);
      return copy;
    });

    pushToast('info', 'Regenerating last response…');

    // Re-run: ask engine with last user content
    if (typeof lastUser.content === 'string') {
      try {
        setIsGenerating(true);
        await (cmd as any)._handleInkLine(lastUser.content);
        await refreshSessions();
        pushToast('success', 'Regenerated');
      } finally {
        setIsGenerating(false);
      }
    }
  }, [ensureEngine, pushToast, refreshSessions]);

  const onTogglePinLast = useCallback(async () => {
    const cmd = await ensureEngine();
    await (cmd as any)._inkTogglePinLast();
  }, [ensureEngine]);

  const onReactLast = useCallback(async (reaction: 'up' | 'down') => {
    const cmd = await ensureEngine();
    await (cmd as any)._inkReactLast(reaction);
  }, [ensureEngine]);

  const getRuntimeState = useCallback(() => ({
    tokens,
    cost,
    toolsEnabled,
    planMode,
    tools,
    diffs,
    diffGroups,
    snapshotGroups,
    messages,
    sessions,
    globalHits,
    toasts,
    themeName,
    savedThreadRootId,
    savedThreadLeafId,
    recentCommands,
    usage,
    provider,
    isGenerating,
  }), [tokens, cost, toolsEnabled, planMode, tools, diffs, diffGroups, snapshotGroups, messages, sessions, globalHits, toasts, themeName, savedThreadRootId, savedThreadLeafId, recentCommands, usage, provider, isGenerating]);

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
        getRuntimeState={getRuntimeState}
      />
    </ThemeProvider>
  );
}
