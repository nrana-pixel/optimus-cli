import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';

export interface GlobalSearchHit {
  sessionId: string;
  sessionName: string;
  messageId: string;
  preview: string;
}

export function SearchAllPanel(props: {
  hits: GlobalSearchHit[];
  onQuery: (q: string) => Promise<void>;
  onClose: () => void;
  onSelect: (hit: GlobalSearchHit) => Promise<void>;
}) {
  const [q, setQ] = useState('');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const items = useMemo(() => {
    return props.hits.slice(0, 30).map((h) => ({
      label: `${h.sessionName}: ${h.preview}`,
      value: h,
    }));
  }, [props.hits]);

  return (
    <Modal title="Search all sessions" footer="Type query then Enter to search. Select result to load+jump. Esc closes.">
      <Box>
        <Text dimColor>Query: </Text>
        <TextInput
          value={q}
          onChange={setQ}
          onSubmit={async () => {
            await props.onQuery(q);
          }}
        />
      </Box>

      {items.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <SelectInput items={items} onSelect={async (it) => props.onSelect(it.value as any)} />
        </Box>
      ) : (
        <Text dimColor>{q.trim() ? 'No hits' : 'Enter a query to search'}</Text>
      )}
    </Modal>
  );
}
