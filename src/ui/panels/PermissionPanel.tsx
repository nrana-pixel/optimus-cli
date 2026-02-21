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
      paddingX={2}
      paddingY={0}
      borderStyle="round"
      borderColor="yellow"
      width="100%"
      marginY={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box>
          <Text bold color="black" backgroundColor="yellow">  🛡️ PERMISSION REQUIRED  </Text>
          <Box marginLeft={1}>
            <Text dimColor italic>Security Checkpoint</Text>
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text>Optimus is requesting access to execute the following tools:</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        {calls.map((call, i) => (
          <Box key={i} marginLeft={2}>
            <Text color="cyan">λ </Text>
            <Text bold color="white">{call.name}</Text>
            <Text dimColor> {Object.keys(call.args).length > 0 ? `(${JSON.stringify(call.args).slice(0, 100)}${JSON.stringify(call.args).length > 100 ? '...' : ''})` : '()'} </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} paddingY={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="yellow" justifyContent="space-between">
        <Box flexDirection="row">
          <Box marginRight={2}>
            <Text bold color="green">[Y]</Text>
            <Text> Approve</Text>
          </Box>
          <Box marginRight={2}>
            <Text bold color="red">[N]</Text>
            <Text> Deny</Text>
          </Box>
          <Box marginRight={2}>
            <Text bold color="blue">[A]</Text>
            <Text> Always Allow</Text>
          </Box>
          <Box>
            <Text bold color="yellow">[F]</Text>
            <Text> Feedback</Text>
          </Box>
        </Box>
        <Box>
          <Text dimColor>Esc to Deny • Enter to Approve</Text>
        </Box>
      </Box>
    </Box>
  );
}
