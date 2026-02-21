import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import { UIMessage, getTextFromContent } from '../types.js';

export function TagPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onTag: (messageId: string, tag: string) => Promise<void>;
  onUntag: (messageId: string, tag: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tag, setTag] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = props.messages.filter((m) => m.role !== 'system');
    const list = !query ? base : base.filter((m) => `${m.role} ${getTextFromContent(m.content)}`.toLowerCase().includes(query));
    return list.slice(-30).reverse();
  }, [props.messages, q]);

  const items = filtered.map((m) => ({
    label: `${m.role}: ${getTextFromContent(m.content).replace(/\n/g, ' ').slice(0, 90)}`,
    value: m.id,
  }));

  const selected = props.messages.find((m) => m.id === selectedId);
  const existingTags = selected?.tags ?? [];

  return (
    <Modal title="Tags" footer="Select message, then add/remove tags. Esc closes.">
      {!selectedId ? (
        <>
          <Box>
            <Text dimColor>Filter: </Text>
            <TextInput value={q} onChange={setQ} />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <SelectInput items={items} onSelect={(it) => setSelectedId(String(it.value))} />
          </Box>
        </>
      ) : (
        <>
          <Text dimColor>Selected tags: {existingTags.length ? existingTags.join(', ') : '(none)'}</Text>
          <Box marginTop={1}>
            <Text dimColor>Add tag: </Text>
            <TextInput
              value={tag}
              onChange={setTag}
              onSubmit={async () => {
                const t = tag.trim();
                if (!t || !selectedId) return;
                await props.onTag(selectedId, t);
                setTag('');
              }}
            />
          </Box>

          {existingTags.length ? (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Remove tag:</Text>
              <SelectInput
                items={existingTags.map((t) => ({ label: t, value: t }))}
                onSelect={async (it) => {
                  await props.onUntag(selectedId, String(it.value));
                }}
              />
            </Box>
          ) : null}

          <Box marginTop={1}>
            <Text dimColor>Esc to close, or re-open to tag another message.</Text>
          </Box>
        </>
      )}
    </Modal>
  );
}
