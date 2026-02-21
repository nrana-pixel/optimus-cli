import React from 'react';
import { Box, Text } from 'ink';
import type { UIMessage, ContentBlock } from './types.js';
import { useTheme } from './Theme.js';
import { InlineDiffView } from './InlineDiffView.js';

function roleLabel(theme: ReturnType<typeof useTheme>, role: UIMessage['role']) {
  if (role === 'user') return { label: 'You', color: theme.user as any };
  if (role === 'assistant') return { label: 'Optimus', color: theme.assistant as any };
  return { label: 'System', color: theme.dim as any };
}

function renderContent(block: ContentBlock) {
  if (block.type === 'text') {
    return <Text>{block.text}</Text>;
  }
  if (block.type === 'diff') {
    return <InlineDiffView path={block.path} diffText={block.diffText} language={block.language} />;
  }
  return null;
}

export function MessageList(props: {
  messages: UIMessage[];
  compactMode: boolean;
  anchorMessageId?: string | null;
  maxMessages?: number;
}) {
  const theme = useTheme();
  const { messages, compactMode, maxMessages = 200, anchorMessageId } = props;
  const visible = messages.slice(-maxMessages);

  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((m) => {
        const r = roleLabel(theme, m.role);
        const reactions = (m.reactions ?? []).length
          ? `  (${(m.reactions ?? []).includes('up') ? '👍' : ''}${(m.reactions ?? []).includes('down') ? '👎' : ''})`
          : '';
        const pin = m.pinned ? '📌 ' : '';

        const isAnchor = Boolean(anchorMessageId && m.id === anchorMessageId);
        return (
          <Box key={m.id} flexDirection="column" marginBottom={compactMode ? 0 : 1} borderStyle={isAnchor ? 'round' : undefined} borderColor={isAnchor ? (theme.user as any) : undefined} paddingX={isAnchor ? 1 : 0}>
            <Text>
              <Text color={r.color} bold>
                {pin}{r.label}
              </Text>
              <Text dimColor>{reactions}</Text>
              {m.editedAt ? <Text dimColor>{'  (edited)'}</Text> : null}
            </Text>
            {m.content.map((block, i) => (
              <Box key={i} flexDirection="column">
                {renderContent(block)}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
