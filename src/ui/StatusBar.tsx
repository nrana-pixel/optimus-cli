import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useTheme } from './Theme.js';

export function StatusBar(props: { hint: string; isGenerating?: boolean }) {
  const theme = useTheme();
  return (
    <Box paddingX={1} marginTop={1}>
      <Text dimColor>
        {props.hint}
      </Text>
    </Box>
  );
}
