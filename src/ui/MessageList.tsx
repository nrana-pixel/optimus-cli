import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { UIMessage, ContentBlock } from './types.js';
import { useTheme, type Theme } from './Theme.js';
import { InlineDiffView } from './InlineDiffView.js';
import { TurnSeparator } from './TurnSeparator.js';
import { Typewriter } from './components/Typewriter.js';

function roleLabel(theme: Theme, role: UIMessage['role']) {
  if (role === 'user') return { label: '● YOU', color: theme.user };
  if (role === 'assistant') return { label: '● OPTIMUS', color: theme.assistant };
  return { label: '● SYSTEM', color: theme.dim };
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

function renderContent(theme: Theme, block: ContentBlock, animate: boolean = false) {
  if (block.type === 'text') {
    return (
      <Box paddingLeft={2}>
        {animate ? (
          <Typewriter text={block.text} speed={5} />
        ) : (
          <Text color={theme.text as any}>{block.text}</Text>
        )}
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
  focusedId?: string | null;
  maxMessages?: number;
  columns: number;
}) {
  const theme = useTheme();
  const { messages, compactMode, maxMessages = 200, anchorMessageId, focusedId } = props;
  const visible = useMemo(() => messages.slice(-maxMessages), [messages, maxMessages]);

  const animatedIds = React.useRef(new Set<string>());
  const lastMsgId = visible[visible.length - 1]?.id;

  React.useEffect(() => {
    if (lastMsgId) {
      // Just mark existing but we'll check in render
    }
  }, [lastMsgId]);

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
                {focusedId === m.id && (
                  <Box marginLeft={1}>
                    <Text color={theme.accent as any} dimColor>[C] Copy</Text>
                  </Box>
                )}
              </Box>
              <Box flexDirection="column" marginTop={0}>
                {m.content.map((block, i) => {
                  const isLatestAssistant = m.role === 'assistant' && m.id === lastMsgId;
                  const shouldAnimate = isLatestAssistant && !m.isPartial && !animatedIds.current.has(m.id);

                  if (shouldAnimate && i === m.content.length - 1) {
                    // We only mark it as animated once it starts
                    animatedIds.current.add(m.id);
                  }

                  return (
                    <Box key={i} flexDirection="column">
                      {renderContent(theme, block, shouldAnimate)}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
