import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Modal } from './Modal.js';

export function HelpOverlayPanel(props: { onClose: () => void }) {
  useInput((ch, key) => {
    if (key.escape || ch === '?') props.onClose();
  });

  return (
    <Modal title="Help" footer="Esc or ? closes">
      <Box flexDirection="column">
        <Text bold>Navigation</Text>
        <Text dimColor>- / : command palette</Text>
        <Text dimColor>- Ctrl+F : search (current session)</Text>
        <Text dimColor>- Ctrl+G : search all sessions</Text>
        <Text dimColor>- ↑/↓ : scroll messages</Text>
        <Text dimColor>- PgUp/PgDn : scroll by window</Text>
        <Text dimColor>- Ctrl+A : jump to oldest (top)</Text>
        <Text dimColor>- Ctrl+E : jump to newest (bottom)</Text>

        <Text> </Text>
        <Text bold>Sessions / Export</Text>
        <Text dimColor>- Ctrl+S : sessions</Text>
        <Text dimColor>- Ctrl+E : export panel</Text>
        <Text dimColor>- Ctrl+N : import session</Text>

        <Text> </Text>
        <Text bold>Branches / Threads</Text>
        <Text dimColor>- Ctrl+T : branch from message</Text>
        <Text dimColor>- Ctrl+M : branches list</Text>
        <Text dimColor>- Ctrl+J : sibling branch selection</Text>
        <Text dimColor>- Ctrl+L : exit thread view (all messages)</Text>
        <Text dimColor>- Ctrl+O : branch map</Text>

        <Text> </Text>
        <Text bold>Message operations</Text>
        <Text dimColor>- Ctrl+R : regenerate last assistant</Text>
        <Text dimColor>- Ctrl+P : prune branch</Text>
        <Text dimColor>- Ctrl+B : pins</Text>
        <Text dimColor>- Ctrl+U : tags</Text>
        <Text dimColor>- Ctrl+K : edit any message</Text>
        <Text dimColor>- Ctrl+H : edit assistant message</Text>
        <Text dimColor>- Ctrl+Delete : delete message</Text>

        <Text> </Text>
        <Text bold>Diffs / Tools</Text>
        <Text dimColor>- Ctrl+Y : diffs (tool run selector)</Text>
        <Text dimColor>- In Diff Review: Ctrl+R revert file, Ctrl+A revert run, Ctrl+Y accept</Text>

        <Text> </Text>
        <Text bold>Insights</Text>
        <Text dimColor>- Ctrl+I : analytics</Text>

        <Text> </Text>
        <Text bold>Help</Text>
        <Text dimColor>- F1 : this screen</Text>
        <Text dimColor>- /help-ui : open help from palette</Text>
      </Box>
    </Modal>
  );
}
