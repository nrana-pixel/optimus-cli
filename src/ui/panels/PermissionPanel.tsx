import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from '../Theme.js';
import { InlineDiffView } from '../InlineDiffView.js';
import type { FileDiff } from '../types.js';

export interface PermissionPanelProps {
  calls: any[];
  previews?: FileDiff[];
  onApprove: () => void;
  onDeny: () => void;
  onAlways: () => void;
  onFeedback: (text: string) => void;
}

export function PermissionPanel({ calls, previews, onApprove, onDeny, onAlways, onFeedback }: PermissionPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const options = [
    { label: 'Yes', action: onApprove },
    { label: 'Yes, always allow for this session', action: onAlways },
    { label: 'No, and tell Optimus what to do differently', action: () => setShowFeedbackInput(true) },
    { label: 'No', action: onDeny },
  ];

  useInput((input, key) => {
    if (showFeedbackInput) {
      if (key.escape) setShowFeedbackInput(false);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      options[selectedIndex].action();
    } else if (key.escape) {
      onDeny();
    } else {
      // support number keys 1-4
      const n = parseInt(input);
      if (!isNaN(n) && n >= 1 && n <= options.length) {
        options[n - 1].action();
      }
    }
  });

  if (showFeedbackInput) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="blue" width="100%" marginY={1}>
        <Box marginBottom={1}>
          <Text bold>Feedback to Agent</Text>
        </Box>
        <Text>Tell the agent what to do differently:</Text>
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <TextInput
            value={feedbackText}
            onChange={setFeedbackText}
            onSubmit={() => onFeedback(feedbackText)}
            placeholder="Type your instructions here..."
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel · Enter to send</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      {previews && previews.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {previews.map((d, i) => (
            <Box key={i} marginTop={i === 0 ? 0 : 1}>
              <InlineDiffView path={d.path} diffText={d.diffText} language={d.path.split('.').pop() || 'text'} />
            </Box>
          ))}
        </Box>
      )}

      <Box marginBottom={1}>
        <Text>Do you want to proceed? <Text dimColor italic>(tools: {calls.map(c => c.name).join(', ')})</Text></Text>
      </Box>

      <Box flexDirection="column">
        {options.map((opt, i) => (
          <Box key={i} flexDirection="row">
            <Text color={selectedIndex === i ? 'blue' : undefined}>
              {selectedIndex === i ? '> ' : '  '}
            </Text>
            <Text color={selectedIndex === i ? 'blue' : undefined}>
              {i + 1}. {opt.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
