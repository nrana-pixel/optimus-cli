import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

export function DeleteMessagePanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onDelete: (messageId: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = props.messages.filter((m) => m.role !== 'system');
    const list = !query ? base : base.filter((m) => `${m.role} ${m.content}`.toLowerCase().includes(query));
    return list.slice(-40).reverse();
  }, [props.messages, q]);

  const items = filtered.map((m) => ({
    label: `${m.role}: ${m.content.replace(/\n/g, ' ').slice(0, 90)}`,
    value: m.id,
  }));

  return (
    <Modal title="Delete message" footer="Enter deletes selected message permanently. Esc closes.">
      <Box>
        <Text dimColor>Filter: </Text>
        <TextInput value={q} onChange={setQ} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <SelectInput
          items={items}
          onSelect={async (it) => {
            await props.onDelete(String(it.value));
          }}
        />
      </Box>
    </Modal>
  );
}
