import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';

export function HeaderBar(props: {
  model: string;
  sessionName: string;
  provider: string;
  toolsEnabled: boolean;
  planMode: boolean;
  themeName: string;
  columns: number;
  branch?: string;
  cwd?: string;
}) {
  const theme = useTheme();
  const badge = props.planMode
    ? 'PLAN'
    : props.toolsEnabled
      ? 'TOOLS'
      : 'CHAT';

  const badgeColor = props.planMode ? theme.warn : props.toolsEnabled ? theme.success : theme.dim;

  const title = 'OPTIMUS';

  return (
    <Box flexDirection="column" width={props.columns - 2} marginX={1} marginTop={0}>
      <Box
        borderStyle="round"
        borderColor={theme.accent as any}
        paddingX={1}
        paddingY={0}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box flexDirection="column">
          <Box>
            <Text bold color={theme.accent as any}> {title} </Text>
            <Text color={theme.accent as any}>│</Text>
            <Text dimColor> AI AGENT </Text>
            <Text color={theme.accent as any}>│</Text>
            <Box marginLeft={1}>
              <Text backgroundColor={badgeColor as any} color="black" bold> {badge} </Text>
            </Box>
          </Box>
          <Box marginTop={0}>
            <Text dimColor> {props.cwd || process.cwd()} </Text>
            {props.branch && (
              <Text color={theme.dim as any}> branch: {props.branch} </Text>
            )}
          </Box>
        </Box>

        <Box flexDirection="column" alignItems="flex-end">
          <Box>
            <Text dimColor>Provider: </Text>
            <Text color={theme.text as any} bold>{props.provider}</Text>
          </Box>
          <Box>
            <Text dimColor>Model: </Text>
            <Text color={theme.accent as any}>{props.model}</Text>
          </Box>
          <Box>
            <Text dimColor>Session: </Text>
            <Text dimColor italic>{props.sessionName}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
