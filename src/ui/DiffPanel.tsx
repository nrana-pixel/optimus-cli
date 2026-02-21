import React from 'react';
import { Box, Text } from 'ink';
import type { FileDiff } from './types.js';
import { useTheme } from './Theme.js';

export function DiffPanel(props: { diffs: FileDiff[]; max?: number }) {
  const theme = useTheme();
  const { diffs, max = 3 } = props;
  const recent = diffs.slice(-max);
  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0}>
      {recent.map((d) => {
        const lines = d.diffText.split('\n');
        const blocks: { type: 'add' | 'sub' | 'context'; text: string; lineNum?: number }[] = [];
        let currentLine = 0;

        for (const line of lines) {
          if (line.startsWith('Index:') || line.startsWith('===') || line.startsWith('---') || line.startsWith('+++')) continue;
          if (line.startsWith('@@')) {
            const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
            if (match) currentLine = parseInt(match[1]);
            continue;
          }
          if (line.startsWith('+')) blocks.push({ type: 'add', text: line, lineNum: currentLine++ });
          else if (line.startsWith('-')) blocks.push({ type: 'sub', text: line, lineNum: currentLine });
          else if (line.trim() !== '') blocks.push({ type: 'context', text: line, lineNum: currentLine++ });
        }

        const MAX_PREVIEW = 3;
        const isTruncated = blocks.length > MAX_PREVIEW;
        const display = blocks.slice(0, MAX_PREVIEW);

        return (
          <Box key={d.path} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              <Text color="green">● </Text>
              <Text bold>Update(file_path: {d.path})</Text>
            </Box>
            <Box paddingLeft={1} flexDirection="column">
              <Box flexDirection="row">
                <Text dimColor>|_ Updated </Text>
                <Text bold>{d.path}</Text>
                <Text dimColor> with </Text>
                <Text bold color="green">{d.insertions}</Text>
                <Text dimColor> additions and </Text>
                <Text bold color="red">{d.deletions}</Text>
                <Text dimColor> removals</Text>
              </Box>

              <Box flexDirection="column">
                {display.map((b, i) => {
                  const bgColor = b.type === 'add' ? '#063718' : (b.type === 'sub' ? '#440a0a' : undefined);
                  const color = b.type === 'add' ? 'green' : (b.type === 'sub' ? 'red' : 'white');
                  const lineNum = b.lineNum?.toString().padStart(4, ' ') ?? '    ';

                  return (
                    <Box key={i} paddingLeft={2}>
                      <Text dimColor>{lineNum}  </Text>
                      <Text color={color as any} backgroundColor={bgColor as any}>
                        {b.text}
                      </Text>
                    </Box>
                  );
                })}
                {isTruncated && (
                  <Box paddingLeft={2}>
                    <Text dimColor italic>... (+{blocks.length - MAX_PREVIEW} lines) · Ctrl+T review</Text>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
