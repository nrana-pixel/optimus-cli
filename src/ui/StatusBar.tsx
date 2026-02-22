import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useTheme } from './Theme.js';

export function StatusBar(props: { hint: string; isGenerating?: boolean; step?: string }) {
  const theme = useTheme();
  return (
    <Box paddingX={1} marginTop={1} flexDirection="column">
      {props.isGenerating && (
        <Box marginBottom={0}>
          <Text color={theme.accent as any} bold>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.accent as any} bold> {props.step || 'Thinking'}...</Text>
        </Box>
      )}
      <Text color={theme.dim as any}>
        {props.hint}
      </Text>
    </Box>
  );
}
