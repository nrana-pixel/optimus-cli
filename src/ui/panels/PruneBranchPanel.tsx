import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

export function PruneBranchPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onPrune: (leafId: string) => Promise<void>;
}) {
  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const leafCandidates = useMemo(() => {
    const byId = new Map(props.messages.map((m) => [m.id, m]));
    const hasChild = new Set<string>();
    for (const m of props.messages) {
      if (m.parentMessageId) hasChild.add(m.parentMessageId);
    }
    // leaf = message with parentMessageId but no children
    return props.messages
      .filter((m) => m.parentMessageId && !hasChild.has(m.id))
      .slice(-40)
      .reverse()
      .map((m) => ({
        label: `${m.role}: ${m.content.replace(/\n/g, ' ').slice(0, 90)}`,
        value: m.id,
      }));
  }, [props.messages]);

  return (
    <Modal title="Prune branch" footer="Select a leaf message to delete its branch path. Esc closes.">
      {leafCandidates.length === 0 ? (
        <Text dimColor>No branch leaves found</Text>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={leafCandidates}
            onSelect={async (it) => {
              await props.onPrune(String(it.value));
              props.onClose();
            }}
          />
        </Box>
      )}
    </Modal>
  );
}
