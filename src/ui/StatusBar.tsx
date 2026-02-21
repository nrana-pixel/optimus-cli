import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';

export function StatusBar(props: { hint: string }) {
  const theme = useTheme();
  return (
    <Box borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1}>
      <Text dimColor>{props.hint}</Text>
    </Box>
  );
}
