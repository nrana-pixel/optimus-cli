import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { FileDiff } from '../types.js';

export function ToolRunDiffsPanel(props: {
  diffGroups: Record<string, FileDiff[]>;
  onClose: () => void;
  onSelectRun: (toolRunId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.return && selected) props.onSelectRun(selected);
  });

  const items = useMemo(() => {
    const ids = Object.keys(props.diffGroups);
    return ids.slice(-30).reverse().map((id) => ({
      label: `${id} (${props.diffGroups[id]?.length ?? 0} files)`,
      value: id,
    }));
  }, [props.diffGroups]);

  return (
    <Modal title="Tool runs" footer="Select a toolRunId to review. Enter selects. Esc closes.">
      {items.length === 0 ? (
        <Text dimColor>No tool runs yet</Text>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={items}
            onHighlight={(it) => setSelected(String(it.value))}
            onSelect={(it) => props.onSelectRun(String(it.value))}
          />
        </Box>
      )}
    </Modal>
  );
}
