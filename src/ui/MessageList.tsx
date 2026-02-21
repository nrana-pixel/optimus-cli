import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { UIMessage, ContentBlock } from './types.js';
import { useTheme } from './Theme.js';
import { InlineDiffView } from './InlineDiffView.js';
import { TurnSeparator } from './TurnSeparator.js';

function roleLabel(theme: ReturnType<typeof useTheme>, role: UIMessage['role']) {
  if (role === 'user') return { label: '👤 YOU', color: theme.user as any };
  if (role === 'assistant') return { label: '🤖 OPTIMUS', color: theme.assistant as any };
  return { label: '⚙️ SYSTEM', color: theme.dim as any };
}

function renderPermissionRequest(block: Extract<ContentBlock, { type: 'permission-request' }>) {
  const theme = useTheme();
  const statusColors = {
    pending: 'yellow',
    approved: 'green',
    denied: 'red'
  };
  const statusText = block.status === 'pending' ? 'PENDING APPROVAL' : block.status?.toUpperCase();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={statusColors[block.status || 'pending'] as any} paddingX={1} marginY={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={statusColors[block.status || 'pending'] as any}>
          🛡️ PERMISSION REQUEST
        </Text>
        <Text bold color={statusColors[block.status || 'pending'] as any}>
          [{statusText}]
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>Optimus wants to use these tools:</Text>
        {block.calls.map((call, i) => (
          <Box key={i} marginLeft={2}>
            <Text color="cyan">→ {call.name}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function renderContent(block: ContentBlock) {
  if (block.type === 'text') {
    return (
      <Box paddingLeft={2}>
        <Text>{block.text}</Text>
      </Box>
    );
  }
  if (block.type === 'diff') {
    return <InlineDiffView path={block.path} diffText={block.diffText} language={block.language} />;
  }
  if (block.type === 'permission-request') {
    return renderPermissionRequest(block);
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
  const visible = useMemo(() => messages.slice(-maxMessages), [messages, maxMessages]);

  return (
    <Box flexDirection="column" marginTop={1}>
      {visible.map((m, index) => {
        const r = roleLabel(theme, m.role);
        const reactions = (m.reactions ?? []).length
          ? `  (${(m.reactions ?? []).includes('up') ? '👍' : ''}${(m.reactions ?? []).includes('down') ? '👎' : ''})`
          : '';
        const pin = m.pinned ? '📌 ' : '';

        const isAnchor = Boolean(anchorMessageId && m.id === anchorMessageId);

        // Show separator if this is a user message following an assistant message
        const showSeparator = index > 0 && m.role === 'user' && visible[index - 1].role === 'assistant';

        return (
          <React.Fragment key={m.id}>
            {showSeparator && <TurnSeparator activitySummary="Done" />}
            <Box
              flexDirection="column"
              marginBottom={compactMode ? 0 : 1}
              borderStyle={isAnchor ? 'round' : undefined}
              borderColor={isAnchor ? (theme.user as any) : undefined}
              paddingX={isAnchor ? 1 : 0}
            >
              <Box flexDirection="row">
                <Text bold color={r.color}>
                  {pin}{r.label}
                </Text>
                <Text dimColor>{reactions}</Text>
                {m.editedAt ? <Text dimColor>{'  (edited)'}</Text> : null}
              </Box>
              <Box flexDirection="column" marginTop={0}>
                {m.content.map((block, i) => (
                  <Box key={i} flexDirection="column">
                    {renderContent(block)}
                  </Box>
                ))}
              </Box>
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
