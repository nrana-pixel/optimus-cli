import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ToolRun } from './types.js';
import { useTheme } from './Theme.js';

export function ToolPanel(props: { tools: ToolRun[] }) {
  const theme = useTheme();
  const recent = props.tools.slice(-5);
  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1}>
      <Text bold color={theme.accent as any}>Tools</Text>
      {recent.map((t) => {
        const icon =
          t.status === 'running' ? (
            <Text color={theme.accent as any}>
              <Spinner type="dots" />
            </Text>
          ) : t.status === 'success' ? (
            <Text color={theme.success as any}>✔</Text>
          ) : (
            <Text color={theme.error as any}>✖</Text>
          );

        return (
          <Text key={t.id}>
            {icon} <Text dimColor>{t.label}</Text>
            {t.status === 'error' && t.error ? <Text color={theme.error as any}> — {t.error}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
