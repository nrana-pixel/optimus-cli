import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

export function EditAssistantPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onEdit: (messageId: string, newContent: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = props.messages.filter((m) => m.role === 'assistant');
    const list = !query ? base : base.filter((m) => m.content.toLowerCase().includes(query));
    return list.slice(-30).reverse();
  }, [props.messages, q]);

  const items = filtered.map((m) => ({
    label: `${m.content.replace(/\n/g, ' ').slice(0, 90)}`,
    value: m.id,
  }));

  const selected = props.messages.find((m) => m.id === selectedId);

  return (
    <Modal title="Edit assistant message" footer="Select assistant message, edit, Enter saves. Esc closes.">
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
                setText(msg?.content ?? '');
              }}
            />
          </Box>
        </>
      ) : (
        <>
          <Text dimColor>Editing assistant message</Text>
          <Box marginTop={1}>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={async () => {
                const v = text.trim();
                if (!v || !selectedId) return;
                await props.onEdit(selectedId, v);
                props.onClose();
              }}
            />
          </Box>
          <Text dimColor>Note: editing assistant text does not re-run. Use /branch to continue.</Text>
        </>
      )}
    </Modal>
  );
}
