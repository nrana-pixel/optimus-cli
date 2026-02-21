import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './Theme.js';
import type { PaletteCommand } from './CommandPalette.js';

export function SlashCommandOverlay(props: {
    query: string;
    commands: PaletteCommand[];
    onSelect?: (val: string) => void;
}) {
    const theme = useTheme();
    const q = props.query.slice(1).toLowerCase();

    const filtered = useMemo(() => {
        return props.commands.filter(c =>
            c.value.toLowerCase().slice(1).startsWith(q) ||
            c.title.toLowerCase().includes(q)
        ).slice(0, 5);
    }, [props.commands, q]);

    if (filtered.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={theme.dim as any} paddingX={1} marginBottom={0} marginLeft={2}>
            {filtered.map((c, idx) => (
                <Box key={c.id}>
                    <Text color={theme.accent as any} bold>{c.value}</Text>
                    <Text color={theme.dim as any}> — {c.description}</Text>
                </Box>
            ))}
            <Box marginTop={1}>
                <Text dimColor italic>Tab to autocomplete · </Text>
                <Text dimColor bold>!</Text>
                <Text dimColor italic> for shell command</Text>
            </Box>
        </Box>
    );
}
