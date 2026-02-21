import React from 'react';
import { Box, Text } from 'ink';
import type { FileDiff } from './types.js';
import { useTheme } from './Theme.js';

export function DiffPanel(props: { diffs: FileDiff[]; max?: number }) {
  const theme = useTheme();
  const { diffs, max = 3 } = props;
  const recent = diffs.slice(-max);
  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1}>
      <Text bold color={theme.accent as any}>Diffs</Text>
      {recent.map((d) => (
        <Box key={d.path} flexDirection="column" marginTop={1}>
          <Text>
            <Text bold>{d.path}</Text> <Text dimColor>(+{d.insertions} -{d.deletions})</Text>
          </Text>
          <Text>{d.diffText}</Text>
        </Box>
      ))}
    </Box>
  );
}
