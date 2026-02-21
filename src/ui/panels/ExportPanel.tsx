import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';

export type ExportFormat = 'md' | 'json';

export function ExportPanel(props: {
  defaultPath: string;
  onClose: () => void;
  onExport: (format: ExportFormat, path: string) => Promise<void>;
}) {
  const [path, setPath] = useState(props.defaultPath);

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  return (
    <Modal
      title="Export"
      footer="Choose format, edit path, Enter exports. Esc closes."
    >
      <Box marginBottom={1}>
        <Text dimColor>Path: </Text>
        <TextInput value={path} onChange={setPath} />
      </Box>

      <SelectInput
        items={[
          { label: 'Markdown (.md)', value: 'md' },
          { label: 'JSON (.json)', value: 'json' },
        ]}
        onSelect={async (item) => {
          await props.onExport(item.value as ExportFormat, path);
          props.onClose();
        }}
      />
    </Modal>
  );
}
