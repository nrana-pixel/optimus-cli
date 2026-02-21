import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';

export function TokenMeter({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(1, used / max) : 0;
  const width = 20;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const color = pct > 0.85 ? 'red' : pct > 0.65 ? 'yellow' : 'green';
  return (
    <Text>
      <Text color={color}>{bar}</Text> <Text dimColor>{Math.round(pct * 100)}%</Text>
    </Text>
  );
}

export function StickyHeader(props: {
  model: string;
  sessionName: string;
  toolsEnabled: boolean;
  planMode: boolean;
  tokens: number;
  cost: number;
  tokenLimit: number;
  toolsRunning: number;
}) {
  const theme = useTheme();
  const { model, sessionName, toolsEnabled, planMode, tokens, cost, tokenLimit, toolsRunning } = props;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text bold>Optimus</Text> <Text dimColor>·</Text> <Text color={theme.user as any}>{model}</Text>
        </Text>
        <Text dimColor>{sessionName}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          <Text>{tokens} tok</Text> <Text dimColor>·</Text> <Text>${cost.toFixed(5)}</Text>
          <Text dimColor> · </Text>
          <Text color={toolsEnabled ? (theme.success as any) : (theme.dim as any)}>{toolsEnabled ? '● tools' : '○ tools'}</Text>
          {planMode ? (
            <>
              <Text dimColor> · </Text>
              <Text color={theme.user as any}>🔒 plan</Text>
            </>
          ) : null}
          {toolsRunning > 0 ? (
            <>
              <Text dimColor> · </Text>
              <Text color={theme.accent as any}>⚙ {toolsRunning} running</Text>
            </>
          ) : null}
        </Text>
        <TokenMeter used={tokens} max={tokenLimit} />
      </Box>
    </Box>
  );
}
