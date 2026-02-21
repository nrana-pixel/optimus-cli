import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { UIMessage, ToolRun, FileDiff } from './types.js';

import { MessageList } from './MessageList.js';
import { SearchPanel } from './panels/SearchPanel.js';
import { ExportPanel } from './panels/ExportPanel.js';
import { SettingsPanel, type UISettings } from './panels/SettingsPanel.js';
import { SessionsPanel, type SessionListItem } from './panels/SessionsPanel.js';
import { PinsPanel } from './panels/PinsPanel.js';
import { EditLastPanel } from './panels/EditLastPanel.js';
import { EditMessagePanel } from './panels/EditMessagePanel.js';
import { AnalyticsPanel } from './panels/AnalyticsPanel.js';
import { SearchAllPanel, type GlobalSearchHit } from './panels/SearchAllPanel.js';
import { BranchPanel } from './panels/BranchPanel.js';
import { BranchesPanel } from './panels/BranchesPanel.js';
import { DiffReviewPanel } from './panels/DiffReviewPanel.js';
import { ToolRunDiffsPanel } from './panels/ToolRunDiffsPanel.js';
import { SiblingBranchesPanel } from './panels/SiblingBranchesPanel.js';
import { TagPanel } from './panels/TagPanel.js';
import { DeleteMessagePanel } from './panels/DeleteMessagePanel.js';
import { EditAssistantPanel } from './panels/EditAssistantPanel.js';
import { PruneBranchPanel } from './panels/PruneBranchPanel.js';
import { BranchMapPanel } from './panels/BranchMapPanel.js';
import { ImportSessionPanel } from './panels/ImportSessionPanel.js';
import { HelpOverlayPanel } from './panels/HelpOverlayPanel.js';
import { PromptInput } from './PromptInput.js';
import { StatusBar } from './StatusBar.js';
import { ToolPanel } from './ToolPanel.js';
import { DiffPanel } from './DiffPanel.js';
import { CommandPalette, type PaletteCommand } from './CommandPalette.js';
import { Toasts } from './Toasts.js';
import { useTheme } from './Theme.js';

export interface ChatAppProps {
  initialMessages: UIMessage[];
  model: string;
  sessionName: string;
  tokenLimit: number;
  compactMode: boolean;

  onSubmit: (text: string) => Promise<void>;
  onRegenerateLast: () => Promise<void>;
  onTogglePinLast: () => Promise<void>;
  onReactLast: (reaction: 'up' | 'down') => Promise<void>;

  getRuntimeState: () => {
    tokens: number;
    cost: number;
    toolsEnabled: boolean;
    planMode: boolean;
    tools: ToolRun[];
    diffs: FileDiff[];
    diffGroups: Record<string, FileDiff[]>;
    snapshotGroups: Record<string, any[]>;
    messages: UIMessage[];
    sessions: SessionListItem[];
    globalHits: GlobalSearchHit[];
    toasts: import('./Toasts.js').Toast[];
    themeName: import('./Theme.js').ThemeName;
    savedThreadRootId: string | null;
    savedThreadLeafId: string | null;
    recentCommands: string[];
    usage: Record<string, number>;
    provider: string;
    isGenerating: boolean;
  };
}
function getMessageHeight(m: UIMessage, columns: number, compactMode: boolean): number {
  let lines = 1; // header
  const textLines = (m.content || '').split('\n');
  for (const line of textLines) {
    if (line.length === 0) lines += 1;
    else lines += Math.ceil(line.length / columns);
  }
  if (!compactMode) lines += 1;
  return lines;
}


export function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const theme = useTheme();
  const [input, setInput] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastSearchHits, setLastSearchHits] = useState<string[]>([]);
  const [lastSearchIndex, setLastSearchIndex] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [editLastOpen, setEditLastOpen] = useState(false);
  const [editMessageOpen, setEditMessageOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [searchAllOpen, setSearchAllOpen] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0); // 0 = bottom/newest

  const { stdout } = useStdout();
  const [height, setHeight] = useState(stdout.rows);

  useEffect(() => {
    const onResize = () => setHeight(stdout.rows);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const usableHeight = Math.max(10, height - 15);
  const columns = Math.max(20, Number((process.stdout as any)?.columns) || 80);
  const [page, setPage] = useState(0); // deprecated, kept for compatibility but unused
  const [anchorMessageId, setAnchorMessageId] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<null | { scrollOffset: number; threadRootId: string | null; threadLeafId: string | null }>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadLeafId, setThreadLeafId] = useState<string | null>(null);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [siblingsOpen, setSiblingsOpen] = useState(false);
  const [diffReviewOpen, setDiffReviewOpen] = useState(false);
  const [toolRunsOpen, setToolRunsOpen] = useState(false);
  const [selectedToolRunId, setSelectedToolRunId] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [deleteMsgOpen, setDeleteMsgOpen] = useState(false);
  const [editAssistantOpen, setEditAssistantOpen] = useState(false);
  const [pruneBranchOpen, setPruneBranchOpen] = useState(false);
  const [branchMapOpen, setBranchMapOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [settings, setSettings] = useState<UISettings>({
    theme: 'dark',
    compactMode: false,
    showLineNumbers: false,
  });

  const state = props.getRuntimeState();

  useEffect(() => {
    if (!threadRootId && state.savedThreadRootId) {
      setThreadRootId(state.savedThreadRootId);
    }
    if (!threadLeafId && state.savedThreadLeafId) {
      setThreadLeafId(state.savedThreadLeafId);
    }
  }, [state.savedThreadRootId, state.savedThreadLeafId]);

  const viewMessages = useMemo(() => {
    const allMessages = state.messages;
    if (!threadRootId) return allMessages;
    const byId = new Map(allMessages.map((m) => [m.id, m]));

    const leaf = threadLeafId ? byId.get(threadLeafId) : byId.get(threadRootId);
    const chain: UIMessage[] = [];
    let cur = leaf;
    while (cur) {
      chain.push(cur);
      cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined;
    }
    return chain.reverse();
  }, [state.messages, threadRootId, threadLeafId]);

  // Clamp scrollOffset whenever message view changes (thread/session changes can shrink list)
  useEffect(() => {
    setScrollOffset((o) => Math.min(Math.max(o, 0), Math.max(0, viewMessages.length - 1)));
  }, [viewMessages.length]);

  const hint = useMemo(() => {
    return 'Shortcuts: Press "Esc" to close overlays, Ctrl+C to exit.';
  }, []);

  const submit = useCallback(async () => {
    const v = input.trim();
    if (!v) return;
    setInput('');
    setAnchorMessageId(null);
    await props.onSubmit(v);
  }, [input, props]);

  const anyModal = paletteOpen || searchOpen || exportOpen || settingsOpen || sessionsOpen || pinsOpen || editLastOpen || analyticsOpen || searchAllOpen || branchOpen || branchesOpen || toolRunsOpen || diffReviewOpen || siblingsOpen || tagOpen || editAssistantOpen || deleteMsgOpen || pruneBranchOpen || branchMapOpen || importOpen || helpOpen;

  useInput(async (ch, key) => {
    if (key.ctrl && ch === 'c') exit();

    // global palette (only when input is empty to avoid hijacking normal typing like paths)
    if (!paletteOpen && !searchOpen && !exportOpen && !settingsOpen && ch === '/' && input.trim().length === 0) {
      setPaletteOpen(true);
    }

    // panels
    if (key.ctrl && ch === 'f') setSearchOpen(true);

    // return to previous view after jump-to
    if (key.ctrl && ch === 'z') {
      if (returnState) {
        setScrollOffset(returnState.scrollOffset);
        setThreadRootId(returnState.threadRootId);
        setThreadLeafId(returnState.threadLeafId);
        setAnchorMessageId(null);
        setReturnState(null);
      }
    }
    if (key.ctrl && key.shift && (ch === 'n' || ch === 'N')) {
      if (lastSearchHits.length) {
        const next = (lastSearchIndex + 1) % lastSearchHits.length;
        setLastSearchIndex(next);
        if (!returnState) setReturnState({ scrollOffset, threadRootId, threadLeafId });
        setAnchorMessageId(lastSearchHits[next]);
      }
    }
    if (key.ctrl && key.shift && (ch === 'p' || ch === 'P')) {
      if (lastSearchHits.length) {
        const prev = (lastSearchIndex - 1 + lastSearchHits.length) % lastSearchHits.length;
        setLastSearchIndex(prev);
        if (!returnState) setReturnState({ scrollOffset, threadRootId, threadLeafId });
        setAnchorMessageId(lastSearchHits[prev]);
      }
    }
    if (key.ctrl && ch === 'e') setExportOpen(true);
    if (key.ctrl && ch === ',') setSettingsOpen(true);
    if (key.ctrl && (ch === 's' || ch === 'S')) setSessionsOpen(true);
    if (key.ctrl && (ch === 'b' || ch === 'B')) setPinsOpen(true);
    if (key.ctrl && (ch === 'g' || ch === 'G')) setSearchAllOpen(true);
    if (key.ctrl && (ch === 'i' || ch === 'I')) setAnalyticsOpen(true);
    if (key.ctrl && (ch === 't' || ch === 'T')) setBranchOpen(true);
    if (key.ctrl && (ch === 'l' || ch === 'L')) {
      setThreadRootId(null);
      setThreadLeafId(null);
    }
    if (key.ctrl && (ch === 'm' || ch === 'M')) setBranchesOpen(true);
    if (key.ctrl && (ch === 'y' || ch === 'Y')) {
      setToolRunsOpen(true);
    }
    if (key.ctrl && (ch === 'k' || ch === 'K')) setEditMessageOpen(true);
    if (key.ctrl && (ch === 'j' || ch === 'J')) setSiblingsOpen(true);
    if (key.ctrl && (ch === 'u' || ch === 'U')) setTagOpen(true);
    if (key.ctrl && (ch === 'h' || ch === 'H')) setEditAssistantOpen(true);
    if (key.ctrl && key.delete) setDeleteMsgOpen(true);
    if (key.ctrl && (ch === 'p' || ch === 'P')) setPruneBranchOpen(true);
    if (key.ctrl && (ch === 'o' || ch === 'O')) setBranchMapOpen(true);
    if (key.ctrl && (ch === 'n' || ch === 'N')) setImportOpen(true);
    // F1 (varies by terminal). Try common sequences.
    const seq = (key as any).sequence ?? ch;
    if (seq === '\u001BOP' || seq === '\u001B[11~' || seq === '\u001B[1;2P') setHelpOpen(true);

    // virtualization scroll
    if (!anyModal) {
      if (key.upArrow) {
        setAnchorMessageId(null);
        setScrollOffset((o) => Math.min(o + 1, Math.max(0, viewMessages.length - 1)));
      }
      if (key.downArrow) {
        setAnchorMessageId(null);
        setScrollOffset((o) => Math.max(o - 1, 0));
      }
      if (key.pageUp) {
        setAnchorMessageId(null);
        setScrollOffset((o) => Math.min(o + 20, Math.max(0, viewMessages.length - 1)));
      }
      if (key.pageDown) {
        setAnchorMessageId(null);
        setScrollOffset((o) => Math.max(o - 20, 0));
      }
      // top/bottom
      if (key.ctrl && ch === 'a') {
        setAnchorMessageId(null);
        setScrollOffset(Math.max(0, viewMessages.length - 1));
      }
      if (key.ctrl && ch === 'e') {
        setAnchorMessageId(null);
        setScrollOffset(0);
      }
    }

    // agent controls
    if (key.ctrl && ch === 'r') await props.onRegenerateLast();
    if (key.ctrl && ch === 'p') await props.onTogglePinLast();
    if (key.ctrl && ch === 'u') await props.onReactLast('up');
    if (key.ctrl && ch === 'd') await props.onReactLast('down');
  });

  const commands: PaletteCommand[] = [
    { id: 'help', title: 'Help', value: '/help', description: 'Show commands and shortcuts', category: 'General' },
    { id: 'clear', title: 'Clear', value: '/clear', description: 'Clear chat history', category: 'General' },
    { id: 'history', title: 'History', value: '/history', description: 'Print conversation so far', category: 'General' },
    { id: 'model', title: 'Model', value: '/model', description: 'Show or change model', category: 'Config' },
    { id: 'tools', title: 'Tools', value: '/tools', description: 'Toggle tools', category: 'Agent' },
    { id: 'plan', title: 'Plan mode', value: '/plan', description: 'Toggle read-only mode', category: 'Agent' },
    { id: 'undo', title: 'Undo', value: '/undo', description: 'Undo last file changes', category: 'Agent' },
    { id: 'changes', title: 'Changes', value: '/changes', description: 'Show changes this session', category: 'Agent' },
    { id: 'mcp', title: 'MCP', value: '/mcp', description: 'Show MCP servers', category: 'Integrations' },
    { id: 'index', title: 'Index', value: '/index', description: 'Build/refresh index', category: 'Index' },
    { id: 'repomap', title: 'Repo map', value: '/repomap', description: 'Show repo map', category: 'Index' },
    { id: 'semantic', title: 'Semantic', value: '/semantic', description: 'Semantic search', category: 'Index' },
    { id: 'cost', title: 'Cost', value: '/cost', description: 'Show tokens + cost', category: 'General' },
    { id: 'sessions', title: 'Sessions', value: '/sessions', description: 'List sessions', category: 'General' },
    { id: 'save', title: 'Save', value: '/save', description: 'Save session', category: 'General' },
    { id: 'search', title: 'Search', value: '/search', description: 'Search current session', category: 'Navigation', example: '/search' },
    { id: 'export', title: 'Export', value: '/export', description: 'Export current session', category: 'Navigation', example: '/export' },
    { id: 'settings', title: 'Settings', value: '/settings', description: 'Theme/layout settings', category: 'Navigation', example: '/settings' },
    { id: 'sessions-ui', title: 'Sessions UI', value: '/sessions-ui', description: 'Open sessions panel', category: 'Navigation', example: '/sessions-ui' },
    { id: 'pins', title: 'Pins', value: '/pins', description: 'Show pinned messages', category: 'Navigation', example: '/pins' },
    { id: 'edit-last', title: 'Edit last prompt', value: '/edit-last', description: 'Edit last user message and re-run', category: 'Message', example: '/edit-last' },
    { id: 'edit', title: 'Edit message', value: '/edit', description: 'Edit any message and branch re-run', category: 'Message', example: '/edit' },
    { id: 'regen-last', title: 'Regenerate', value: '/regen', description: 'Regenerate last assistant response', category: 'Message', example: '/regen' },
    { id: 'branch', title: 'Branch', value: '/branch', description: 'Branch from an earlier message (thread view)', category: 'Message', example: '/branch' },
    { id: 'thread-all', title: 'Show all messages', value: '/thread-all', description: 'Exit thread view', category: 'Navigation' },
    { id: 'branches', title: 'Branches', value: '/branches', description: 'Manage/switch branches', category: 'Navigation', example: '/branches' },
    { id: 'diffs', title: 'Diff review', value: '/diffs', description: 'Review and revert diffs', category: 'Navigation', example: '/diffs' },
    { id: 'tags', title: 'Tags', value: '/tags', description: 'Tag/untag messages', category: 'Message', example: '/tags' },
    { id: 'delete-msg', title: 'Delete message', value: '/delete-msg', description: 'Delete a message permanently', category: 'Message', example: '/delete-msg' },
    { id: 'edit-asst', title: 'Edit assistant', value: '/edit-asst', description: 'Edit assistant message text', category: 'Message', example: '/edit-asst' },
    { id: 'prune-branch', title: 'Prune branch', value: '/prune-branch', description: 'Delete a branch path', category: 'Message', example: '/prune-branch' },
    { id: 'branch-map', title: 'Branch map', value: '/branch-map', description: 'Show branch tree', category: 'Navigation', example: '/branch-map' },
    { id: 'import', title: 'Import session', value: '/import', description: 'Import session JSON', category: 'Navigation', example: '/import ./session.json' },
    { id: 'analytics', title: 'Analytics', value: '/analytics', description: 'Session stats and insights', category: 'Insights', example: '/analytics' },
    { id: 'search-all', title: 'Search all sessions', value: '/search-all', description: 'Search across saved sessions', category: 'Navigation', example: '/search-all "query"' },
    { id: 'help-ui', title: 'Help', value: '/help-ui', description: 'Keyboard shortcuts and help', category: 'General', example: '/help-ui' },
    { id: 'exit', title: 'Exit', value: '/exit', description: 'Quit', category: 'General', example: '/exit' },
  ];

  return (
    <Box flexDirection="column" height={height} overflow="hidden">

      {anchorMessageId ? (
        <Box borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1} display={anyModal ? 'none' : 'flex'}>
          <Text dimColor>
            Jumped to a search hit. Ctrl+Z to return. Ctrl+Shift+N/P to cycle hits.
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column" display={anyModal ? 'none' : 'flex'} flexGrow={1} justifyContent="flex-end">
        {(() => {
          if (anchorMessageId) {
            const idx = viewMessages.findIndex((m) => m.id === anchorMessageId);
            if (idx >= 0) {
              const slice: UIMessage[] = [];
              let currentHeight = 0;
              const anchorM = viewMessages[idx];
              currentHeight += getMessageHeight(anchorM, columns, settings.compactMode);
              slice.push(anchorM);

              let upIdx = idx - 1;
              let downIdx = idx + 1;
              while (currentHeight < usableHeight && (upIdx >= 0 || downIdx < viewMessages.length)) {
                if (upIdx >= 0) {
                  const m = viewMessages[upIdx];
                  const h = getMessageHeight(m, columns, settings.compactMode);
                  if (currentHeight + h <= usableHeight) {
                    currentHeight += h;
                    slice.unshift(m);
                    upIdx--;
                  } else upIdx = -1;
                }
                if (currentHeight < usableHeight && downIdx < viewMessages.length) {
                  const m = viewMessages[downIdx];
                  const h = getMessageHeight(m, columns, settings.compactMode);
                  if (currentHeight + h <= usableHeight) {
                    currentHeight += h;
                    slice.push(m);
                    downIdx++;
                  } else downIdx = viewMessages.length;
                }
              }
              const start = upIdx + 1;
              return (
                <>
                  {start === 0 && (
                    <Box paddingX={1} paddingBottom={1} flexShrink={0}>
                      <Text dimColor>Optimus · {props.model} · {props.sessionName}</Text>
                    </Box>
                  )}
                  <MessageList
                    messages={slice}
                    compactMode={settings.compactMode}
                    anchorMessageId={anchorMessageId}
                  />
                </>
              );
            }
          }

          const slice: UIMessage[] = [];
          let currentHeight = 0;
          let viewEnd = Math.max(0, viewMessages.length - scrollOffset);
          let startIdx = viewEnd - 1;

          while (startIdx >= 0) {
            const m = viewMessages[startIdx];
            const msgH = getMessageHeight(m, columns, settings.compactMode);
            if (currentHeight + msgH > usableHeight && slice.length > 0) break;
            currentHeight += msgH;
            slice.unshift(m);
            startIdx--;
          }

          // If we hit the top and haven't filled the screen, pull in newer messages
          if (startIdx < 0 && currentHeight < usableHeight) {
            let nextEnd = viewEnd;
            while (nextEnd < viewMessages.length) {
              const m = viewMessages[nextEnd];
              const msgH = getMessageHeight(m, columns, settings.compactMode);
              if (currentHeight + msgH > usableHeight) break;
              currentHeight += msgH;
              slice.push(m);
              nextEnd++;
            }
          }

          const start = Math.max(0, startIdx + 1);

          return (
            <>
              {start === 0 && (
                <Box paddingX={1} paddingBottom={1} flexShrink={0}>
                  <Text dimColor>Optimus · {props.model} · {props.sessionName}</Text>
                </Box>
              )}
              <MessageList
                messages={slice}
                compactMode={settings.compactMode}
                anchorMessageId={null}
              />
            </>
          );
        })()}

        <ToolPanel tools={state.tools} />
        <DiffPanel diffs={state.diffs} />
      </Box>

      {paletteOpen ? (
        <CommandPalette
          commands={commands}
          recent={state.recentCommands}
          onCancel={() => setPaletteOpen(false)}
          onSelect={async (cmd) => {
            setPaletteOpen(false);
            await props.onSubmit(`/ recent - cmd ${cmd} `);

            // local-only commands
            if (cmd === '/search') {
              setSearchOpen(true);
              return;
            }
            if (cmd === '/export') {
              setExportOpen(true);
              return;
            }
            if (cmd === '/settings') {
              setSettingsOpen(true);
              return;
            }
            if (cmd === '/sessions-ui') {
              setSessionsOpen(true);
              return;
            }
            if (cmd === '/pins') {
              setPinsOpen(true);
              return;
            }
            if (cmd === '/edit-last') {
              setEditLastOpen(true);
              return;
            }
            if (cmd === '/edit') {
              setEditMessageOpen(true);
              return;
            }
            if (cmd === '/analytics') {
              setAnalyticsOpen(true);
              return;
            }
            if (cmd === '/search-all') {
              setSearchAllOpen(true);
              return;
            }
            if (cmd === '/branch') {
              setBranchOpen(true);
              return;
            }
            if (cmd === '/thread-all') {
              setThreadRootId(null);
              return;
            }
            if (cmd === '/branches') {
              setBranchesOpen(true);
              return;
            }
            if (cmd === '/diffs') {
              setToolRunsOpen(true);
              return;
            }
            if (cmd === '/tags') {
              setTagOpen(true);
              return;
            }
            if (cmd === '/delete-msg') {
              setDeleteMsgOpen(true);
              return;
            }
            if (cmd === '/edit-asst') {
              setEditAssistantOpen(true);
              return;
            }
            if (cmd === '/prune-branch') {
              setPruneBranchOpen(true);
              return;
            }
            if (cmd === '/branch-map') {
              setBranchMapOpen(true);
              return;
            }
            if (cmd === '/import') {
              setImportOpen(true);
              return;
            }
            if (cmd === '/help-ui') {
              setHelpOpen(true);
              return;
            }
            if (cmd === '/regen') {
              await props.onRegenerateLast();
              return;
            }

            await props.onSubmit(cmd);
          }}
        />
      ) : null}

      {searchOpen ? (
        <SearchPanel
          messages={state.messages}
          onClose={() => setSearchOpen(false)}
          onJumpTo={(id, hits) => {
            setSearchOpen(false);
            if (!returnState) setReturnState({ scrollOffset, threadRootId, threadLeafId });
            setAnchorMessageId(id);
            if (hits?.length) {
              setLastSearchHits(hits);
              setLastSearchIndex(Math.max(0, hits.indexOf(id)));
            }
          }}
        />
      ) : null}

      {exportOpen ? (
        <ExportPanel
          defaultPath={`./ ${props.sessionName}.md`}
          onClose={() => setExportOpen(false)}
          onExport={async (format, path) => {
            await props.onSubmit(`/export -ui ${format} ${path} `);
          }}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onUpdate={async (next) => {
            setSettings(next);
            await props.onSubmit(`/ settings ${next.theme} ${next.compactMode ? 'compact' : 'normal'} ${next.showLineNumbers ? 'lines' : 'nolines'} `);
          }}
        />
      ) : null}

      {sessionsOpen ? (
        <SessionsPanel
          sessions={state.sessions}
          onClose={() => setSessionsOpen(false)}
          onLoad={async (id) => {
            await props.onSubmit(`/ load - session ${id} `);
            setSessionsOpen(false);
          }}
          onDelete={async (id) => {
            await props.onSubmit(`/ delete -session ${id} `);
          }}
        />
      ) : null}

      {pinsOpen ? (
        <PinsPanel
          messages={state.messages}
          onClose={() => setPinsOpen(false)}
          onJumpTo={(id) => {
            setPinsOpen(false);
            setAnchorMessageId(id);
          }}
        />
      ) : null}

      {editLastOpen ? (
        <EditLastPanel
          initial={(() => {
            const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
            return lastUser?.content ?? '';
          })()}
          onClose={() => setEditLastOpen(false)}
          onSubmit={async (newText) => {
            await props.onSubmit(`/ edit - last ${JSON.stringify(newText)} `);
          }}
        />
      ) : null}

      {editMessageOpen ? (
        <EditMessagePanel
          messages={state.messages}
          onClose={() => setEditMessageOpen(false)}
          onEditAndBranch={async (messageId, newContent) => {
            await props.onSubmit(`/ edit - branch ${messageId} ${JSON.stringify(newContent)} `);
            setThreadRootId(messageId);
          }}
        />
      ) : null}

      {analyticsOpen ? (
        <AnalyticsPanel
          messages={state.messages}
          tokens={state.tokens}
          cost={state.cost}
          tools={state.tools}
          usage={state.usage}
          model={props.model}
          provider={state.provider}
          onClose={() => setAnalyticsOpen(false)}
        />
      ) : null}

      {searchAllOpen ? (
        <SearchAllPanel
          hits={state.globalHits}
          onClose={() => setSearchAllOpen(false)}
          onQuery={async (q) => {
            const res = await props.onSubmit(`/ search - all ${JSON.stringify(q)} `);
            void res;
          }}
          onSelect={async (hit) => {
            await props.onSubmit(`/ load - session ${hit.sessionId} `);
            setAnchorMessageId(hit.messageId);
            setSearchAllOpen(false);
          }}
        />
      ) : null}

      {branchOpen ? (
        <BranchPanel
          messages={state.messages}
          onClose={() => setBranchOpen(false)}
          onSelectParent={async (parentId) => {
            // Start branch: controller will set a thread root and next message will reference parent
            await props.onSubmit(`/ branch ${parentId} `);
            setThreadRootId(parentId);
          }}
        />
      ) : null}

      {branchesOpen ? (
        <BranchesPanel
          messages={state.messages}
          onClose={() => setBranchesOpen(false)}
          onSelectThread={async (rootId) => {
            setThreadRootId(rootId);
            await props.onSubmit(`/ thread - root ${rootId ?? ''} `);
          }}
        />
      ) : null}

      {toolRunsOpen ? (
        <ToolRunDiffsPanel
          diffGroups={state.diffGroups}
          onClose={() => setToolRunsOpen(false)}
          onSelectRun={(id) => {
            setSelectedToolRunId(id);
            setToolRunsOpen(false);
            setDiffReviewOpen(true);
          }}
        />
      ) : null}

      {diffReviewOpen ? (
        <DiffReviewPanel
          diffs={selectedToolRunId ? (state.diffGroups[selectedToolRunId] ?? []) : state.diffs}
          onClose={() => setDiffReviewOpen(false)}
          onRevertFile={async (path) => {
            await props.onSubmit(`/ revert - file ${path} `);
          }}
          onRevertAll={async () => {
            if (selectedToolRunId) await props.onSubmit(`/ revert - run ${selectedToolRunId} `);
            else await props.onSubmit('/revert-all');
          }}
          onAccept={() => {
            if (selectedToolRunId) void props.onSubmit(`/ accept - run ${selectedToolRunId} `);
            else void props.onSubmit('/accept-diffs');
            setDiffReviewOpen(false);
          }}
        />
      ) : null}

      {siblingsOpen && threadRootId ? (
        <SiblingBranchesPanel
          messages={state.messages}
          parentId={threadRootId}
          onClose={() => setSiblingsOpen(false)}
          onSelectChild={async (childId) => {
            setThreadLeafId(childId);
            await props.onSubmit(`/ thread - leaf ${childId} `);
          }}
        />
      ) : null}

      {tagOpen ? (
        <TagPanel
          messages={state.messages}
          onClose={() => setTagOpen(false)}
          onTag={async (id, tag) => props.onSubmit(`/ tag - msg ${id} ${JSON.stringify(tag)} `)}
          onUntag={async (id, tag) => props.onSubmit(`/ untag - msg ${id} ${JSON.stringify(tag)} `)}
        />
      ) : null}

      {deleteMsgOpen ? (
        <DeleteMessagePanel
          messages={state.messages}
          onClose={() => setDeleteMsgOpen(false)}
          onDelete={async (id) => {
            await props.onSubmit(`/ delete -msg ${id} `);
          }}
        />
      ) : null}

      {editAssistantOpen ? (
        <EditAssistantPanel
          messages={state.messages}
          onClose={() => setEditAssistantOpen(false)}
          onEdit={async (id, content) => {
            await props.onSubmit(`/ edit - asst ${id} ${JSON.stringify(content)} `);
          }}
        />
      ) : null}

      {pruneBranchOpen ? (
        <PruneBranchPanel
          messages={state.messages}
          onClose={() => setPruneBranchOpen(false)}
          onPrune={async (leafId) => {
            await props.onSubmit(`/ prune - branch ${leafId} `);
          }}
        />
      ) : null}

      {branchMapOpen ? (
        <BranchMapPanel
          messages={state.messages}
          onClose={() => setBranchMapOpen(false)}
          onSelectNode={async (id) => {
            setAnchorMessageId(id);
            // also set as thread root for quick thread view
            setThreadRootId(id);
            setThreadLeafId(null);
            await props.onSubmit(`/ thread - root ${id} `);
            setBranchMapOpen(false);
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportSessionPanel
          onClose={() => setImportOpen(false)}
          onImport={async (p) => {
            await props.onSubmit(`/import ${p} `);
          }}
        />
      ) : null}

      {helpOpen ? (
        <HelpOverlayPanel onClose={() => setHelpOpen(false)} />
      ) : null}

      <Box flexDirection="column" flexShrink={0}>
        <Box marginTop={1}>
          <PromptInput
            value={input}
            onChange={(v) => {
              if (v === '?') {
                setHelpOpen(!helpOpen);
                return;
              }
              setInput(v);
            }}
            onSubmit={submit}
            disabled={paletteOpen || searchOpen || exportOpen || settingsOpen || sessionsOpen || pinsOpen || editLastOpen || editMessageOpen || analyticsOpen || searchAllOpen || branchOpen || branchesOpen || diffReviewOpen || toolRunsOpen || siblingsOpen || tagOpen || deleteMsgOpen || editAssistantOpen || pruneBranchOpen || branchMapOpen || importOpen || helpOpen}
          />
        </Box>

        <Toasts toasts={state.toasts} />

        {state.isGenerating && <StatusBar hint="Generating..." isGenerating={true} />}
        <Text dimColor>Tip: Press “?” for shortcuts. Press “/” for palette. Ctrl+R regen. Ctrl+U/Ctrl+D react.</Text>
      </Box>
    </Box>
  );
}
