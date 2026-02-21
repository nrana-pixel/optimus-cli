import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import { type UIMessage, getTextFromContent } from '../types.js';

export function SearchPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onJumpTo: (messageId: string, hitIds?: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.ctrl && (ch === 'n' || ch === 'N')) {
      setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
    }
    if (key.ctrl && (ch === 'p' || ch === 'P')) {
      setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    }
    if (key.return) {
      // Jump to currently selected item
      const idx = Math.min(Math.max(0, selectedIndex), results.length - 1);
      const hit = results[idx];
      if (hit) props.onJumpTo(hit.id, results.map((r) => r.id));
    }
  });

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: UIMessage[] = [];
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i];
      const hay = `${m.role} ${getTextFromContent(m.content)}`.toLowerCase();
      if (hay.includes(query)) out.push(m);
      if (out.length >= 20) break;
    }
    return out;
  }, [props.messages, q]);

  // keep selection in range
  const safeIndex = results.length ? Math.min(selectedIndex, results.length - 1) : 0;

  const items = results.map((m) => ({
    label: `${m.role}: ${getTextFromContent(m.content).replace(/\n/g, ' ').slice(0, 80)}`,
    value: m.id,
  }));

  return (
    <Modal
      title="Search"
      footer="Type to search. Ctrl+N/Ctrl+P next/prev. Enter jumps. Esc closes."
    >
      <Box>
        <Text dimColor>Query: </Text>
        <TextInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setSelectedIndex(0);
          }}
        />
      </Box>

      {q.trim() && items.length === 0 ? <Text dimColor>No matches</Text> : null}

      {items.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={items}
            initialIndex={safeIndex}
            onHighlight={(item) => {
              const idx = items.findIndex((x) => x.value === item.value);
              if (idx >= 0) setSelectedIndex(idx);
            }}
            onSelect={(item) => props.onJumpTo(String(item.value), results.map((r) => r.id))}
          />
        </Box>
      ) : null}
    </Modal>
  );
}
