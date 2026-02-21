import React, { useState, useEffect } from 'react';
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
}) {
  const badge = props.planMode
    ? 'PLAN'
    : props.toolsEnabled
      ? 'TOOLS'
      : 'CHAT';

  const badgeColor = props.planMode ? 'yellow' : props.toolsEnabled ? 'green' : 'gray';

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const cats = ['(=^･ω･^=)', '(=^･ｪ･^=)', '(=^>ω<^=)', '(=^･ω･^=) zZ'];
  const cat = cats[frame % cats.length];

  const title = 'OPTIMUS';
  const subtitle = 'AI Coding Agent';
  const left = `${title} · ${subtitle}`;
  const right = `${props.provider} · ${props.model} · ${props.sessionName}`;

  return (
    <Box paddingY={0} paddingRight={2}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="blue"
        paddingX={1}
        width={75}
      >
        <Text bold color="blueBright">Welcome to Optimus Command <Text color="magenta">{cat}</Text></Text>
        <Text dimColor>Session ID: {props.sessionName}</Text>
        <Text dimColor>Version: 1.0.0 (latest)</Text>
        <Text dimColor>Provider: <Text color="white">{props.provider}</Text> ({props.model})</Text>
        <Text dimColor>Mode: <Text color={badgeColor as any} bold>{badge}</Text></Text>
      </Box>
    </Box>
  );
}
