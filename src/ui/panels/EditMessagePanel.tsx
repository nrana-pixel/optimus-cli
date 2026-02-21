import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

function getTextFromContent(content: UIMessage['content']): string {
  return content.map(block => block.type === 'text' ? block.text : '').join('\n');
}

export function EditMessagePanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onEditAndBranch: (messageId: string, newContent: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = props.messages.filter((m) => m.role !== 'system');
    const list = !query
      ? base
      : base.filter((m) => `${m.role} ${getTextFromContent(m.content)}`.toLowerCase().includes(query));
    return list.slice(-30).reverse();
  }, [props.messages, q]);

  const items = filtered.map((m) => ({
    label: `${m.role}: ${getTextFromContent(m.content).replace(/\n/g, ' ').slice(0, 90)}`,
    value: m.id,
  }));

  const selected = props.messages.find((m) => m.id === selectedId);

  return (
    <Modal title="Edit message" footer="Step 1: filter+select. Step 2: edit text. Enter to branch re-run. Esc closes.">
      {!selectedId ? (
        <>
          <Box>
            <Text dimColor>Filter: </Text>
            <TextInput value={q} onChange={setQ} />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <SelectInput
              items={items}
              onSelect={(it) => {
                const id = String(it.value);
                setSelectedId(id);
                const msg = props.messages.find((m) => m.id === id);
                setText(msg ? getTextFromContent(msg.content) : '');
              }}
            />
          </Box>
        </>
      ) : (
        <>
          <Text dimColor>Editing: {selected?.role}</Text>
          <Box marginTop={1}>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={async () => {
                const v = text.trim();
                if (!v || !selectedId) return;
                await props.onEditAndBranch(selectedId, v);
                props.onClose();
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Enter to re-run as a new branch from this message.</Text>
          </Box>
        </>
      )}
    </Modal>
  );
}
