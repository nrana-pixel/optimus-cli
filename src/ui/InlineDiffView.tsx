import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';
import { highlight } from 'cli-highlight';

interface InlineDiffViewProps {
  path: string;
  diffText: string;
  language: string;
}

export function InlineDiffView({ path, diffText, language }: InlineDiffViewProps) {
  const theme = useTheme();

  const highlighted = highlight(diffText, { language: 'diff', ignoreIllegals: true });

  const lines = highlighted.split('\n').map((line, i) => {
    let color: string | undefined = undefined;
    if (line.startsWith('+')) color = theme.success;
    if (line.startsWith('-')) color = theme.error;
    if (line.startsWith('@')) color = theme.accent;
    return (
      <Text key={i} color={color}>
        {line}
      </Text>
    );
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      <Text bold>{path}</Text>
      <Box flexDirection="column" marginTop={1}>
        {lines}
      </Box>
    </Box>
  );
}
