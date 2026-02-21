import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Modal } from './Modal.js';

export function EditLastPanel(props: {
  initial: string;
  onClose: () => void;
  onSubmit: (newText: string) => Promise<void>;
}) {
  const [txt, setTxt] = useState(props.initial);

  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  return (
    <Modal title="Edit last prompt" footer="Edit text then Enter to re-run. Esc cancels.">
      <Box>
        <TextInput
          value={txt}
          onChange={setTxt}
          onSubmit={async () => {
            const v = txt.trim();
            if (!v) return;
            await props.onSubmit(v);
            props.onClose();
          }}
        />
      </Box>
    </Modal>
  );
}
