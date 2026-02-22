import React from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from './Theme.js';

export function PromptInput(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  recentCommands?: string[];
}) {
  const theme = useTheme();

  // Ghost completion logic
  const suggestion = React.useMemo(() => {
    if (!props.value || !props.recentCommands?.length) return '';
    const match = props.recentCommands.find(c => c.startsWith(props.value) && c !== props.value);
    return match ? match.slice(props.value.length) : '';
  }, [props.value, props.recentCommands]);

  useInput((input, key) => {
    if (props.disabled) return;
    if (key.rightArrow && suggestion) {
      props.onChange(props.value + suggestion);
    }
  });

  return (
    <Box flexDirection="column" marginTop={1} marginX={1}>
      <Box flexDirection="row" alignItems="center">
        <Text color={theme.accent as any} bold>❯</Text>
        <Box
          flexGrow={1}
          position="relative"
          marginLeft={1}
        >
          <Text color={theme.text as any}>
            <TextInput
              value={props.value}
              onChange={props.onChange}
              onSubmit={props.onSubmit}
              focus={!props.disabled}
              placeholder="Ask Optimus..."
            />
          </Text>
          {suggestion && (
            <Box position="absolute" marginLeft={props.value.length}>
              <Text color={theme.dim as any}>{suggestion}</Text>
            </Box>
          )}
        </Box>
      </Box>

      {suggestion && (
        <Box paddingLeft={4} marginTop={0}>
          <Text color={theme.dim as any} dimColor italic>Press → to autocomplete</Text>
        </Box>
      )}
    </Box>
  );
}
