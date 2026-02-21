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
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      {recent.map((t) => {
        const isRunning = t.status === 'running';
        const color = t.status === 'success' ? 'green' : (t.status === 'error' ? 'red' : theme.accent as any);

        return (
          <Box key={t.id} flexDirection="column" marginBottom={isRunning ? 0 : 1}>
            <Box flexDirection="row">
              <Text color={color}>{isRunning ? <Spinner type="dots" /> : '● '}</Text>
              <Text bold>{t.label}</Text>
            </Box>
            {!isRunning && (
              <Box paddingLeft={1} flexDirection="column">
                <Text dimColor italic>|_ Completed tool {t.id.split('-')[0]}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
