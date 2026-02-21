import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import { UIMessage, getTextFromContent } from '../types.js';

export function SiblingBranchesPanel(props: {
  messages: UIMessage[];
  parentId: string;
  onClose: () => void;
  onSelectChild: (childId: string) => Promise<void>;
}) {
  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const children = useMemo(() => {
    return props.messages
      .filter((m) => m.parentMessageId === props.parentId)
      .slice(-30)
      .reverse();
  }, [props.messages, props.parentId]);

  const items = children.map((c) => ({
    label: `${c.role}: ${getTextFromContent(c.content).replace(/\n/g, ' ').slice(0, 90)}`,
    value: c.id,
  }));

  return (
    <Modal title="Sibling branches" footer="Pick which child reply to follow. Esc closes.">
      {items.length === 0 ? (
        <Text dimColor>No child branches found</Text>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={items}
            onSelect={async (it) => {
              await props.onSelectChild(String(it.value));
              props.onClose();
            }}
          />
        </Box>
      )}
    </Modal>
  );
}
