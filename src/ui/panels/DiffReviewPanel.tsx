import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { FileDiff } from '../types.js';
import { InlineDiffView } from '../InlineDiffView.js';

export function DiffReviewPanel(props: {
  diffs: FileDiff[];
  onClose: () => void;
  onRevertFile: (path: string) => Promise<void>;
  onRevertAll: () => Promise<void>;
  onAccept: () => void;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.ctrl && (ch === 'a' || ch === 'A')) void props.onRevertAll();
    if (key.ctrl && (ch === 'r' || ch === 'R')) {
      if (selectedPath) void props.onRevertFile(selectedPath);
    }
    if (key.ctrl && (ch === 'y' || ch === 'Y')) {
      props.onAccept();
      props.onClose();
    }
  });

  const items = useMemo(() => {
    if (!props.diffs.length) return [];
    return props.diffs
      .slice(-50)
      .reverse()
      .map((d) => ({
        label: `${d.path} (+${d.insertions} -${d.deletions})`,
        value: d.path,
      }));
  }, [props.diffs]);

  const preview = useMemo(() => {
    if (!props.diffs.length) return null;
    if (selectedPath) return props.diffs.find((d) => d.path === selectedPath) ?? null;
    return props.diffs[props.diffs.length - 1];
  }, [props.diffs, selectedPath]);

  return (
    <Box flexDirection="column" paddingX={0} paddingY={0}>
      <Box marginBottom={1} marginTop={1}>
        <Text bold color="magenta">● Diff Review </Text>
        <Text dimColor>(Use ↓/↑ to switch files · Esc/Ctrl+T to close)</Text>
      </Box>

      {items.length === 0 ? (
        <Box paddingLeft={1} marginBottom={1}>
          <Text dimColor italic>|_ No changes to review in this session.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="column">
            {preview && (
              <InlineDiffView
                path={preview.path}
                diffText={preview.diffText}
                language={preview.path.split('.').pop() || 'text'}
                full
              />
            )}
          </Box>

          <Box flexDirection="column" marginTop={1} paddingLeft={1}>
            <Text bold color="magenta"> FILES:</Text>
            <SelectInput
              items={items}
              onHighlight={(it) => setSelectedPath(String(it.value))}
              onSelect={async (it) => {
                const p = String(it.value);
                setSelectedPath(p);
              }}
            />
          </Box>
        </Box>
      )}

      <Box marginTop={1} marginBottom={1} paddingLeft={1}>
        <Text dimColor>
          Ctrl+R <Text color="white">revert</Text> ·
          Ctrl+A <Text color="white">revert all</Text> ·
          Ctrl+Y <Text color="white">accept</Text>
        </Text>
      </Box>
    </Box>
  );
}
