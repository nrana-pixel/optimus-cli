import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from '../Theme.js';

export interface PermissionPanelProps {
  calls: any[];
  onApprove: () => void;
  onDeny: () => void;
  onAlways: () => void;
  onFeedback: (text: string) => void;
}

export function PermissionPanel({ calls, onApprove, onDeny, onAlways, onFeedback }: PermissionPanelProps) {
  const theme = useTheme();
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  useInput((input, key) => {
    if (showFeedbackInput) {
      if (key.escape) {
        setShowFeedbackInput(false);
      }
      return;
    }

    const cmd = input.toLowerCase();
    if (cmd === 'y' || key.return) {
      onApprove();
    } else if (cmd === 'n') {
      onDeny();
    } else if (cmd === 'a') {
      onAlways();
    } else if (cmd === 'f') {
      setShowFeedbackInput(true);
    } else if (key.escape) {
      onDeny();
    }
  });

  if (showFeedbackInput) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        borderStyle="single"
        borderColor="yellow"
        width="100%"
      >
        <Box marginBottom={1}>
          <Text bold color="yellow">Feedback to Agent</Text>
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
          <Text dimColor>(Press Enter to send, Esc to cancel)</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="single"
      borderColor="yellow"
      width="100%"
    >
      <Box marginBottom={1}>
        <Text bold color="yellow">Permission Required</Text>
      </Box>

      <Text>Optimus wants to use these tools:</Text>
      
      <Box flexDirection="column" marginY={1}>
        {calls.map((call, i) => (
          <Box key={i} marginLeft={2}>
            <Text color="cyan">→ {call.name}</Text>
            <Text dimColor> ({JSON.stringify(call.args).slice(0, 80)}{JSON.stringify(call.args).length > 80 ? '...' : ''})</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text>[<Text color="green" bold>Y</Text>]es, allow </Text>
          <Text>  [<Text color="red" bold>N</Text>]o, deny </Text>
        </Box>
        <Box marginTop={0.5}>
          <Text>[<Text color="blue" bold>A</Text>]llow for this session </Text>
          <Text>  [<Text color="yellow" bold>F</Text>]eedback (deny and tell why)</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(Shortcut: Y/N/A/F or Enter for Yes, Esc for No)</Text>
      </Box>
    </Box>
  );
}
