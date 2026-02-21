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

  useInput((ch, key) => {
    if (key.escape) props.onCancel();
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => i + 1);
    if (key.return) {
      const cmd = rows.filter((r) => r.kind === 'cmd')[Math.min(selected, cmdRows.length - 1)] as any;
      if (cmd?.cmd?.value) props.onSelect(cmd.cmd.value);
    }
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = props.commands;

    // boost recents
    const recentSet = new Set(props.recent);
    list = [...list].sort((a, b) => {
      const ar = recentSet.has(a.value) ? 1 : 0;
      const br = recentSet.has(b.value) ? 1 : 0;
      return br - ar;
    });

    if (!q) return list;
    return list.filter((c) => {
      return (
        c.value.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [props.commands, props.recent, query]);

  const rows: Row[] = useMemo(() => {
    const byCat = new Map<string, PaletteCommand[]>();
    for (const c of filtered) {
      const cat = c.category ?? 'Other';
      const arr = byCat.get(cat) ?? [];
      arr.push(c);
      byCat.set(cat, arr);
    }

    // Recents section first
    const recentSet = new Set(props.recent);
    const recentCmds = filtered.filter((c) => recentSet.has(c.value)).slice(0, 8);

    const orderedCats = [...byCat.keys()].sort();
    const out: Row[] = [];

    if (recentCmds.length) {
      out.push({ kind: 'header', label: 'Recent' });
      for (const c of recentCmds) out.push({ kind: 'cmd', cmd: c });
    }

    for (const cat of orderedCats) {
      // don't duplicate recents section
      out.push({ kind: 'header', label: cat });
      for (const c of (byCat.get(cat) ?? []).slice(0, 8)) {
        out.push({ kind: 'cmd', cmd: c });
      }
    }
    return out;
  }, [filtered, props.recent]);

  const cmdRows = useMemo(() => rows.filter((r) => r.kind === 'cmd') as any[], [rows]);
  const safeSelected = Math.min(selected, Math.max(0, cmdRows.length - 1));
  const current = cmdRows[safeSelected]?.cmd as PaletteCommand | undefined;

  // scroll window over rows (not just cmds)
  const visibleRows = 8;
  const selectedValue = current?.value;
  const selectedRowIndex = selectedValue ? rows.findIndex((r) => r.kind === 'cmd' && r.cmd.value === selectedValue) : 0;
  const scrollStart = Math.max(0, selectedRowIndex - Math.floor(visibleRows / 2));
  const windowRows = rows.slice(scrollStart, scrollStart + visibleRows);


  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent as any} paddingX={1} marginTop={1} flexShrink={0}>
      <Text bold color={theme.accent as any}>Command Palette</Text>
      <Text color={theme.dim as any}>Type to filter · ↑/↓ select · Enter run · Esc close</Text>
      <Box marginTop={1}>
        <Text color={theme.dim as any}>Search: </Text>
        <TextInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setSelected(0);
          }}
        />
      </Box>

      <Box marginTop={1}>
        <Box width="60%" flexDirection="column">
          {rows.length === 0 ? <Text dimColor>No commands</Text> : null}
          {windowRows.map((r, idx) => {
            if (r.kind === 'header') {
              return (
                <Text key={`${r.label}-${idx}`} color={theme.dim as any}>
                  {r.label}
                </Text>
              );
            }
            const cmdIndex = cmdRows.findIndex((x) => x.cmd.value === r.cmd.value);
            const isSel = cmdIndex === safeSelected;
            return (
              <Text key={`${r.cmd.value}-${idx}`} color={isSel ? (theme.accent as any) : undefined}>
                {isSel ? '> ' : '  '}
                <Text bold>{r.cmd.value}</Text>
                {r.cmd.description ? <Text color={theme.dim as any}> — {r.cmd.description}</Text> : null}
              </Text>
            );
          })}
        </Box>

        <Box width="40%" paddingLeft={2} flexDirection="column">
          <Text bold color={theme.accent as any}>Help</Text>
          {current ? (
            <>
              <Text><Text bold>{current.title}</Text></Text>
              <Text color={theme.dim as any}>{current.description ?? ''}</Text>
              <Text color={theme.dim as any}>Command: {current.value}</Text>
              {current.example ? (
                <Text color={theme.dim as any}>Example: {current.example}</Text>
              ) : null}
            </>
          ) : (
            <Text color={theme.dim as any}>No selection</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
