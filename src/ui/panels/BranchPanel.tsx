import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import { UIMessage, getTextFromContent } from '../types.js';

export function BranchPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onSelectParent: (messageId: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = props.messages.filter((m) => m.role !== 'system');
    const filtered = !query
      ? base
      : base.filter((m) => `${m.role} ${getTextFromContent(m.content)}`.toLowerCase().includes(query));

    return filtered.slice(-30).reverse().map((m) => ({
      label: `${m.role}: ${getTextFromContent(m.content).replace(/\n/g, ' ').slice(0, 90)}`,
      value: m.id,
    }));
  }, [props.messages, q]);

  return (
    <Modal title="Branch" footer="Pick a message to branch from. Type to filter. Enter selects. Esc closes.">
      <Box>
        <Text dimColor>Filter: </Text>
        <TextInput value={q} onChange={setQ} />
      </Box>

      {items.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={items}
            onSelect={async (it) => {
              await props.onSelectParent(String(it.value));
              props.onClose();
            }}
          />
        </Box>
      ) : (
        <Text dimColor>No messages</Text>
      )}
    </Modal>
  );
}
