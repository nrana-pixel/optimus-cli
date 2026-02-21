import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';
import type { FileDiff } from '../types.js';

function iconForDiff(d: FileDiff) {
  if (d.insertions > 0 && d.deletions === 0) return '+';
  if (d.deletions > 0 && d.insertions === 0) return '-';
  return '±';
}

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
    if (key.ctrl && ch === 'a') void props.onRevertAll();
    if (key.ctrl && ch === 'r') {
      if (selectedPath) void props.onRevertFile(selectedPath);
    }
    if (key.ctrl && ch === 'y') props.onAccept();
  });

  const items = useMemo(() => {
    if (!props.diffs.length) return [];
    return props.diffs
      .slice(-50)
      .reverse()
      .map((d) => ({
        label: `${iconForDiff(d)} ${d.path} (+${d.insertions} -${d.deletions})`,
        value: d.path,
      }));
  }, [props.diffs]);

  const preview = useMemo(() => {
    if (!props.diffs.length) return null;
    if (selectedPath) return props.diffs.find((d) => d.path === selectedPath) ?? null;
    return props.diffs[props.diffs.length - 1];
  }, [props.diffs, selectedPath]);

  return (
    <Modal title="Diff Review" footer="Ctrl+R revert file · Ctrl+A revert all · Ctrl+Y accept (clear list) · Esc closes">
      {items.length === 0 ? (
        <Text dimColor>No diffs to review</Text>
      ) : (
        <Box flexDirection="column">
          <SelectInput
            items={items}
            onHighlight={(it) => setSelectedPath(String(it.value))}
            onSelect={async (it) => {
              const p = String(it.value);
              setSelectedPath(p);
              await props.onRevertFile(p);
            }}
          />
        </Box>
      )}

      {preview ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Preview: {preview.path}</Text>
          <Text>{preview.diffText}</Text>
        </Box>
      ) : null}
    </Modal>
  );
}
