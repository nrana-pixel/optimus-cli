import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../Theme.js';

export function Modal(props: {
  title: string;
  children: React.ReactNode;
  footer?: string;
}) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} paddingY={0} marginTop={1}>
      <Text bold color={theme.accent as any}>{props.title}</Text>
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
      {props.footer ? (
        <Box marginTop={1}>
          <Text color={theme.dim as any}>{props.footer}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
