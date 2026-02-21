import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';
import { highlight } from 'cli-highlight';

interface InlineDiffViewProps {
  path: string;
  diffText: string;
  language: string;
  full?: boolean;
}

export function InlineDiffView({ path, diffText, language, full }: InlineDiffViewProps) {
  const theme = useTheme();

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

  const MAX_LINES = full ? Infinity : 6;
  const isTruncated = blocks.length > MAX_LINES;
  const displayBlocks = blocks.slice(0, MAX_LINES);

  return (
    <Box flexDirection="column" marginY={0} paddingLeft={1}>
      <Box flexDirection="row">
        <Text bold color="green">● </Text>
        <Text bold>Update(file_path: {path})</Text>
      </Box>
      <Box paddingLeft={1} flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>|_ Updated </Text>
          <Text bold>{path}</Text>
          <Text dimColor> with </Text>
          <Text bold color="green">{stats.add}</Text>
          <Text dimColor> additions and </Text>
          <Text bold color="red">{stats.sub}</Text>
          <Text dimColor> removals</Text>
        </Box>

        <Box flexDirection="column" marginTop={0}>
          {displayBlocks.map((block, i) => {
            const bgColor = block.type === 'add' ? '#063718' : (block.type === 'sub' ? '#440a0a' : undefined);
            const color = block.type === 'add' ? 'green' : (block.type === 'sub' ? 'red' : 'white');
            const lineNum = block.lineNum?.toString().padStart(4, ' ') ?? '    ';

            return (
              <Box key={i} paddingLeft={2}>
                <Text dimColor>{lineNum}  </Text>
                <Text color={color as any} backgroundColor={bgColor as any}>
                  {block.text}
                </Text>
              </Box>
            );
          })}
          {isTruncated && (
            <Box paddingLeft={2}>
              <Text dimColor italic>... (+{blocks.length - MAX_LINES} lines) · press Ctrl+T to view all</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
