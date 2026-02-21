import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../Theme.js';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';

export interface SessionListItem {
  id: string;
  name: string;
  updatedAt: string;
  messageCount: number;
}

export function SessionsPanel(props: {
  sessions: SessionListItem[];
  onClose: () => void;
  onLoad: (sessionId: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const theme = useTheme();
  const [mode, setMode] = useState<'load' | 'delete'>('load');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.tab) setMode((m) => (m === 'load' ? 'delete' : 'load'));
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = !query
      ? props.sessions
      : props.sessions.filter((s) => s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query));
    return list.slice(0, 20);
  }, [props.sessions, q]);

  const items = filtered.map((s) => ({
    label: `${s.name}  (${s.messageCount} msgs)  ${new Date(s.updatedAt).toLocaleString()}`,
    value: s.id,
  }));

  return (
    <Modal title="Sessions" footer="Type to filter. Tab toggles Load/Delete. Enter executes. Esc closes.">
      <Box>
        <Text dimColor>Filter: </Text>
        <TextInput value={q} onChange={setQ} />
      </Box>

      <Box marginTop={1}>
        <Text>
          Mode: <Text color={mode === 'load' ? (theme.success as any) : (theme.error as any)} bold>{mode.toUpperCase()}</Text>
          <Text dimColor> (Tab to toggle)</Text>
        </Text>
      </Box>

      {items.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SelectInput
            items={items}
            onSelect={async (item) => {
              const id = String(item.value);
              if (mode === 'load') await props.onLoad(id);
              else await props.onDelete(id);
            }}
          />
        </Box>
      ) : (
        <Text dimColor>No sessions</Text>
      )}
    </Modal>
  );
}
