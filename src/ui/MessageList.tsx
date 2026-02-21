import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { UIMessage, ContentBlock } from './types.js';
import { useTheme } from './Theme.js';
import { InlineDiffView } from './InlineDiffView.js';
import { TurnSeparator } from './TurnSeparator.js';

function roleLabel(theme: ReturnType<typeof useTheme>, role: UIMessage['role']) {
  if (role === 'user') return { label: '● YOU', color: 'white' };
  if (role === 'assistant') return { label: '● OPTIMUS', color: 'green' };
  return { label: '● SYSTEM', color: 'gray' };
}

function renderPermissionRequest(block: Extract<ContentBlock, { type: 'permission-request' }>) {
  const label = block.status === 'pending' ? 'WAITING' : block.status?.toUpperCase();
  const color = block.status === 'approved' ? 'green' : (block.status === 'denied' ? 'red' : 'gray');

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2} marginY={0}>
        <Text color={color as any}>[{label}]</Text>
        <Text dimColor> tools: {block.calls.map(c => c.name).join(', ')}</Text>
      </Box>
      {block.status !== 'pending' && block.previewDiffs?.map((d, i) => (
        <Box key={i} marginTop={1}>
          <InlineDiffView path={d.path} diffText={d.diffText} language={d.path.split('.').pop() || 'text'} />
        </Box>
      ))}
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
  columns: number;
}) {
  const theme = useTheme();
  const { messages, compactMode, maxMessages = 200, anchorMessageId } = props;
  const visible = useMemo(() => messages.slice(-maxMessages), [messages, maxMessages]);

  return (
    <Box flexDirection="column">
      {visible.map((m, index) => {
        const r = roleLabel(theme, m.role);
        const reactions = (m.reactions ?? []).length
          ? ` (${(m.reactions ?? []).includes('up') ? '+' : ''}${(m.reactions ?? []).includes('down') ? '-' : ''})`
          : '';
        const pin = m.pinned ? '[P] ' : '';

        const isAnchor = Boolean(anchorMessageId && m.id === anchorMessageId);

        return (
          <React.Fragment key={m.id}>
            <Box
              flexDirection="column"
              marginBottom={compactMode ? 0 : 1}
              paddingX={0}
            >
              <Box flexDirection="row">
                <Text bold color={r.color as any}>
                  {pin}{r.label}
                </Text>
                <Text dimColor>{reactions}</Text>
                {m.editedAt ? <Text dimColor>{' (edited)'}</Text> : null}
                {isAnchor && <Text color="yellow"> [FOCUS]</Text>}
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
