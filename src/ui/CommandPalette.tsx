import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from './Theme.js';

export interface PaletteCommand {
  id: string;
  title: string;
  value: string;
  description?: string;
  category?: string;
  example?: string;
}

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'cmd'; cmd: PaletteCommand };

export function CommandPalette(props: {
  commands: PaletteCommand[];
  recent: string[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    if (props.recent.length > 0) cats.add('Recent');
    for (const c of props.commands) {
      if (c.category) cats.add(c.category);
    }
    return Array.from(cats);
  }, [props.commands, props.recent]);

  const [activeCategory, setActiveCategory] = useState(categories[0] || 'General');

  useInput((ch, key) => {
    if (key.escape) props.onCancel();
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(cmdRows.length - 1, i + 1));
    if (key.leftArrow) {
      const idx = categories.indexOf(activeCategory);
      const next = (idx - 1 + categories.length) % categories.length;
      setActiveCategory(categories[next]);
      setSelected(0);
    }
    if (key.rightArrow) {
      const idx = categories.indexOf(activeCategory);
      const next = (idx + 1) % categories.length;
      setActiveCategory(categories[next]);
      setSelected(0);
    }
    if (key.return) {
      const currentCmd = cmdRows[selected];
      if (currentCmd?.value) props.onSelect(currentCmd.value);
    }
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = props.commands;

    if (!q) {
      // If no query, filter by active category
      if (activeCategory === 'Recent') {
        const recentSet = new Set(props.recent);
        return list.filter(c => recentSet.has(c.value));
      }
      return list.filter(c => c.category === activeCategory);
    }

    // If query exists, search across all
    return list.filter((c) => {
      return (
        c.value.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [props.commands, props.recent, query, activeCategory]);

  const cmdRows = filtered;
  const safeSelected = Math.min(selected, Math.max(0, cmdRows.length - 1));
  const current = cmdRows[safeSelected];

  const visibleRows = 10;
  const scrollStart = Math.max(0, safeSelected - Math.floor(visibleRows / 2));
  const windowCmds = cmdRows.slice(scrollStart, scrollStart + visibleRows);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1} flexShrink={0} width={80}>
      <Box justifyContent="space-between">
        <Text bold color={theme.accent as any}>Command Palette</Text>
        <Text color={theme.dim as any}>{activeCategory}</Text>
      </Box>
      <Text color={theme.dim as any}>Filter: {query || 'None'} · ←/→ Switch Tabs · ↑/↓ Select · Enter Run · Esc Close</Text>

      {/* Tabs */}
      {!query && (
        <Box marginTop={1} paddingBottom={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={theme.dim as any}>
          {categories.map((cat) => {
            const isActive = cat === activeCategory;
            return (
              <Box key={cat} marginX={1} paddingX={1}>
                <Text color={isActive ? (theme.accent as any) : (theme.dim as any)} bold={isActive} inverse={isActive}>
                  {cat}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {query && (
        <Box marginTop={1} paddingBottom={1}>
          <Text dimColor italic>Searching all categories...</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.text as any}>Search: </Text>
        <TextInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setSelected(0);
          }}
        />
      </Box>

      <Box marginTop={1}>
        <Box width="60%" flexDirection="column" minHeight={visibleRows}>
          {cmdRows.length === 0 ? <Text dimColor>No commands found</Text> : null}
          {windowCmds.map((c, idx) => {
            const isSel = (idx + scrollStart) === safeSelected;
            return (
              <Text key={c.id} color={isSel ? (theme.accent as any) : (theme.text as any)} wrap="truncate">
                {isSel ? '> ' : '  '}
                <Text bold>{c.value.padEnd(15)}</Text>
                <Text color={theme.dim as any}>{c.title}</Text>
              </Text>
            );
          })}
        </Box>

        <Box width="40%" paddingLeft={2} flexDirection="column" borderStyle="single" borderTop={false} borderBottom={false} borderRight={false} borderColor={theme.dim as any}>
          <Text bold color={theme.accent as any}>Details</Text>
          {current ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold wrap="wrap" color={theme.text as any}>{current.title}</Text>
              <Box marginTop={1}>
                <Text color={theme.dim as any} wrap="wrap">{current.description ?? 'No description available'}</Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Usage:</Text>
                <Text color="cyan">{current.value}</Text>
              </Box>
              {current.example ? (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor>Example:</Text>
                  <Text italic color={theme.dim as any}>{current.example}</Text>
                </Box>
              ) : null}
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text color={theme.dim as any}>No selection</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
