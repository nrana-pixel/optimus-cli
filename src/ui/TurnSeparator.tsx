import React from 'react';
import { Box, Text } from 'ink';

export function TurnSeparator(props: {
    durationSecs?: number;
    activitySummary?: string;
    columns: number;
}) {
    const label = (props.activitySummary || "Turn complete") + (props.durationSecs !== undefined ? ` after ${props.durationSecs}s` : "");
    const totalLines = Math.max(10, props.columns - label.length - 4);
    const leftCount = Math.floor(totalLines / 2);
    const rightCount = totalLines - leftCount;

    return (
        <Box flexDirection="row" alignItems="center" marginY={1} width={props.columns}>
            <Text dimColor>{"─".repeat(leftCount)}</Text>
            <Box paddingX={1}>
                <Text dimColor>{label}</Text>
            </Box>
            <Text dimColor>{"─".repeat(rightCount)}</Text>
        </Box>
    );
}
