import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Modal } from './Modal.js';

export function ImportSessionPanel(props: {
  onClose: () => void;
  onImport: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState('./session.json');

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  return (
    <Modal title="Import session" footer="Enter path to a session JSON. Enter imports. Esc closes.">
      <Box>
        <Text dimColor>Path: </Text>
        <TextInput
          value={path}
          onChange={setPath}
          onSubmit={async () => {
            const p = path.trim();
            if (!p) return;
            await props.onImport(p);
            props.onClose();
          }}
        />
      </Box>
    </Modal>
  );
}
