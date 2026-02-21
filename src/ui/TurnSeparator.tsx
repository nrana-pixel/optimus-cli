import React from 'react';
import { Box, Text } from 'ink';

export function TurnSeparator(props: {
    durationSecs?: number;
    activitySummary?: string;
}) {
    return (
        <Box flexDirection="row" alignItems="center" marginY={1}>
            <Box flexGrow={1} height={1}>
                <Text dimColor>{"─".repeat(100)}</Text>
            </Box>
            <Box paddingX={1}>
                <Text dimColor>
                    {props.activitySummary || "Turn complete"}
                    {props.durationSecs !== undefined && ` after ${props.durationSecs}s`}
                </Text>
            </Box>
            <Box flexGrow={1} height={1}>
                <Text dimColor>{"─".repeat(100)}</Text>
            </Box>
        </Box>
    );
}
