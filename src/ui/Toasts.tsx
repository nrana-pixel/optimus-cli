import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

export function Toasts(props: { toasts: Toast[] }) {
  const theme = useTheme();
  if (!props.toasts.length) return null;
  const t = props.toasts[props.toasts.length - 1];
  const color = t.type === 'success' ? theme.success : t.type === 'error' ? theme.error : t.type === 'warn' ? theme.warn : theme.user;
  return (
    <Box borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1}>
      <Text color={color}>{t.message}</Text>
    </Box>
  );
}
