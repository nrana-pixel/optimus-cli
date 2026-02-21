import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeName } from './Theme.js';

export function HeaderBar(props: {
  model: string;
  sessionName: string;
  provider: string;
  toolsEnabled: boolean;
  planMode: boolean;
  themeName: ThemeName;
  columns: number;
  branch?: string;
  cwd?: string;
}) {
  const badge = props.planMode
    ? 'PLAN'
    : props.toolsEnabled
      ? 'TOOLS'
      : 'CHAT';

  const badgeColor = props.planMode ? 'yellow' : props.toolsEnabled ? 'green' : 'gray';

  const title = 'OPTIMUS';

  return (
    <Box flexDirection="column" width={props.columns - 2} marginX={1} marginTop={0}>
      <Box
        borderStyle="round"
        borderColor="blue"
        paddingX={1}
        paddingY={0}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box flexDirection="column">
          <Box>
            <Text bold color="blueBright"> {title} </Text>
            <Text color="blue">│</Text>
            <Text dimColor> AI AGENT </Text>
            <Text color="blue">│</Text>
            <Box marginLeft={1}>
              <Text backgroundColor={badgeColor as any} color="black" bold> {badge} </Text>
            </Box>
          </Box>
          <Box marginTop={0}>
            <Text dimColor> {props.cwd || process.cwd()} </Text>
            {props.branch && (
              <Text color="magenta"> branch: {props.branch} </Text>
            )}
          </Box>
        </Box>

        <Box flexDirection="column" alignItems="flex-end">
          <Box>
            <Text dimColor>Provider: </Text>
            <Text color="white" bold>{props.provider}</Text>
          </Box>
          <Box>
            <Text dimColor>Model: </Text>
            <Text color="cyan">{props.model}</Text>
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
