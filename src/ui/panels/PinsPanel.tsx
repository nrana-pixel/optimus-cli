import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

export function PinsPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}) {
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState<'time' | 'tag'>('time');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.tab) setMode((m) => (m === 'time' ? 'tag' : 'time'));
  });

  const pinned = useMemo(() => {
    const t = tag.trim().toLowerCase();
    const onlyPinned = props.messages.filter((m) => m.pinned);
    const filtered = !t
      ? onlyPinned
      : onlyPinned.filter((m: any) => (m as any).tags?.some((x: string) => x.toLowerCase().includes(t)));

    if (mode === 'time') return filtered;

    // mode === 'tag': group by first tag (or '(untagged)') then by role
    return [...filtered].sort((a: any, b: any) => {
      const at = (a.tags?.[0] ?? '(untagged)').toLowerCase();
      const bt = (b.tags?.[0] ?? '(untagged)').toLowerCase();
      if (at !== bt) return at.localeCompare(bt);
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return a.timestamp.localeCompare(b.timestamp);
    });
  }, [props.messages, tag, mode]);

  const items = pinned.slice(-50).reverse().map((m: any) => {
    const t = (m.tags?.length ? m.tags.join(',') : '(untagged)');
    return {
      label: `[${t}] ${m.role}: ${m.content.replace(/\n/g, ' ').slice(0, 80)}`,
      value: m.id,
    };
  });

  return (
    <Modal title="Pins" footer={`Pinned messages. Tab toggles sort (${mode}). Filter by tag. Enter jumps. Esc closes.`}>
      <Box>
        <Text dimColor>Tag filter: </Text>
        <TextInput value={tag} onChange={setTag} />
      </Box>

      {items.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SelectInput items={items} onSelect={(item) => props.onJumpTo(String(item.value))} />
        </Box>
      ) : (
        <Text dimColor>No pinned messages</Text>
      )}
    </Modal>
  );
}
