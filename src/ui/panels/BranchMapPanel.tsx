import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Modal } from './Modal.js';
import { useTheme } from '../Theme.js';
import { type UIMessage, getTextFromContent } from '../types.js';

type TreeRow = { id: string; text: string };

function buildTree(messages: UIMessage[]): TreeRow[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const children = new Map<string, UIMessage[]>();
  for (const m of messages) {
    if (!m.parentMessageId) continue;
    const arr = children.get(m.parentMessageId) ?? [];
    arr.push(m);
    children.set(m.parentMessageId, arr);
  }

  const roots = messages.filter((m) => !m.parentMessageId);

  const lines: TreeRow[] = [];
  const walk = (node: UIMessage, prefix: string) => {
    const label = `${node.role}: ${getTextFromContent(node.content).replace(/\n/g, ' ').slice(0, 60)}`;
    lines.push({ id: node.id, text: prefix + label });
    const kids = (children.get(node.id) ?? []).slice(0, 10);
    kids.forEach((k, idx) => {
      const last = idx === kids.length - 1;
      walk(k, prefix + (last ? '   └─ ' : '   ├─ '));
    });
  };

  roots.slice(-10).forEach((r) => walk(r, ''));
  return lines;
}

export function BranchMapPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onSelectNode?: (messageId: string) => Promise<void>;
}) {
  const theme = useTheme();

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const [filter, setFilter] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState(0);

  useInput((ch, key) => {
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
      setOffset((o) => Math.max(0, Math.min(o, selected - 1)));
    }
    if (key.downArrow) {
      setSelected((s) => s + 1);
    }
    if (key.pageUp) {
      setSelected((s) => Math.max(0, s - 10));
      setOffset((o) => Math.max(0, o - 10));
    }
    if (key.pageDown) {
      setSelected((s) => s + 10);
      setOffset((o) => o + 10);
    }
    if (key.return) {
      const rows = treeLines;
      const idx = Math.min(Math.max(0, selected), rows.length - 1);
      const row = rows[idx];
      if (row && props.onSelectNode) void props.onSelectNode(row.id);
    }
  });

  const treeLines = useMemo(() => {
    const lines = buildTree(props.messages);
    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.text.toLowerCase().includes(q));
  }, [props.messages, filter]);

  const safeSelected = Math.min(selected, Math.max(0, treeLines.length - 1));
  const page = treeLines.slice(offset, offset + 80);

  return (
    <Modal title="Branch map" footer="Esc closes. Use ↑/↓ PgUp/PgDn to scroll. Type /branch to branch.">
      <Box flexDirection="column">
        <Box>
          <Text dimColor>Filter: </Text>
          <TextInput value={filter} onChange={(v) => { setFilter(v); setOffset(0); setSelected(0); }} />
        </Box>

        {treeLines.length === 0 ? <Text dimColor>No messages</Text> : null}
        {page.map((l, i) => {
          const absoluteIndex = offset + i;
          const isSel = absoluteIndex === safeSelected;
          return (
            <Text key={l.id} color={isSel ? (theme.accent as any) : undefined}>
              {isSel ? '> ' : '  '}{l.text}
            </Text>
          );
        })}
        {treeLines.length > page.length ? <Text dimColor>Showing {offset + 1}-{offset + page.length} of {treeLines.length}</Text> : null}
      </Box>
    </Modal>
  );
}
