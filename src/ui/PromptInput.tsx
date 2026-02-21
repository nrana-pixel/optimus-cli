import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from './Theme.js';

export function PromptInput(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Box>
      <Text color={theme.accent as any} bold>
        ❯
      </Text>
      <Text> </Text>
      <TextInput
        value={props.value}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        focus={!props.disabled}
      />
    </Box>
  );
}
