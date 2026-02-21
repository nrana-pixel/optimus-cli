import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { UIMessage } from '../types.js';

export interface BranchItem {
  rootId: string;
  label: string;
}

export function BranchesPanel(props: {
  messages: UIMessage[];
  onClose: () => void;
  onSelectThread: (rootId: string | null) => Promise<void>;
}) {
  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const branches = useMemo(() => {
    const childrenOf = new Map<string, number>();
    for (const m of props.messages) {
      if (m.parentMessageId) {
        childrenOf.set(m.parentMessageId, (childrenOf.get(m.parentMessageId) ?? 0) + 1);
      }
    }

    const roots: BranchItem[] = [];
    for (const [pid, count] of childrenOf.entries()) {
      const parent = props.messages.find((m) => m.id === pid);
      const preview = parent ? `${parent.role}: ${parent.content.replace(/\n/g, ' ').slice(0, 70)}` : pid;
      roots.push({ rootId: pid, label: `${preview}  (${count} replies)` });
    }

    // newest first
    return roots.reverse().slice(0, 30);
  }, [props.messages]);

  const items = [
    { label: 'All messages (exit thread view)', value: null as any },
    ...branches.map((b) => ({ label: b.label, value: b.rootId })),
  ];

  return (
    <Modal title="Branches" footer="Select a thread root to view. Esc closes.">
      {items.length > 0 ? (
        <Box flexDirection="column">
          <SelectInput
            items={items}
            onSelect={async (it) => {
              await props.onSelectThread(it.value as any);
              props.onClose();
            }}
          />
        </Box>
      ) : (
        <Text dimColor>No branches yet</Text>
      )}
    </Modal>
  );
}
