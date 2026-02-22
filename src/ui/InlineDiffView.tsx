import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';

interface InlineDiffViewProps {
  path: string;
  diffText: string;
  language: string;
  full?: boolean;
}

export function InlineDiffView({ path, diffText, language, full }: InlineDiffViewProps) {
  const theme = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(!full);

  const lines = diffText.split('\n');
  const blocks: { type: 'add' | 'sub' | 'context' | 'info'; text: string; lineNum?: number }[] = [];

  let currentLine = 0;
  for (const line of lines) {
    if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
      if (match) currentLine = parseInt(match[1]);
      continue;
    }

    if (line.startsWith('+')) {
      blocks.push({ type: 'add', text: line, lineNum: currentLine++ });
    } else if (line.startsWith('-')) {
      blocks.push({ type: 'sub', text: line, lineNum: currentLine });
    } else if (line.trim() !== '') {
      blocks.push({ type: 'context', text: line, lineNum: currentLine++ });
    }
  }

  const stats = {
    add: blocks.filter(b => b.type === 'add').length,
    sub: blocks.filter(b => b.type === 'sub').length,
  };

  const MAX_LINES = 10;
  const displayBlocks = isCollapsed ? [] : blocks.slice(0, full ? Infinity : MAX_LINES);
  const totalHidden = blocks.length - displayBlocks.length;

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1} borderStyle="single" borderColor={theme.dim as any} borderTop={false} borderBottom={false} borderRight={false}>
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Box flexDirection="row">
          <Text bold color={theme.success as any}>{isCollapsed ? '▶' : '▼'} </Text>
          <Text bold color={theme.text as any}>{path}</Text>
          <Text dimColor> (+{stats.add} -{stats.sub})</Text>
        </Box>
        <Box>
          <Text dimColor>
            {isCollapsed ? '[Collapsed]' : '[Expanded]'}
          </Text>
        </Box>
      </Box>

      {!isCollapsed && (
        <Box flexDirection="column" marginTop={0}>
          {displayBlocks.map((block, i) => {
            const color = block.type === 'add' ? theme.success : (block.type === 'sub' ? theme.error : theme.text);
            const lineNum = block.lineNum?.toString().padStart(4, ' ') ?? '    ';

            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor>{lineNum} </Text>
                <Text color={color as any}>
                  {block.type === 'add' ? '+' : (block.type === 'sub' ? '-' : ' ')} {block.text.slice(1)}
                </Text>
              </Box>
            );
          })}
          {totalHidden > 0 && (
            <Box paddingLeft={2}>
              <Text dimColor italic>... (+{totalHidden} more lines)</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
