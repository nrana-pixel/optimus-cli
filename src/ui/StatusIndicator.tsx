import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export function StatusIndicator(props: {
    isRunning: boolean;
    header?: string;
    elapsedSecs?: number;
}) {
    const [dots, setDots] = useState('');

    useEffect(() => {
        if (!props.isRunning) {
            setDots('');
            return;
        }
        const interval = setInterval(() => {
            setDots(d => (d.length >= 3 ? '' : d + '.'));
        }, 500);
        return () => clearInterval(interval);
    }, [props.isRunning]);

    if (!props.isRunning) return null;

    return (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
            <Box marginRight={1}>
                <Spinner type="dots" />
            </Box>
            <Text bold color="cyan">
                {props.header || 'Working'}{dots}
            </Text>
            {props.elapsedSecs !== undefined && (
                <Text dimColor> ({props.elapsedSecs}s)</Text>
            )}
        </Box>
    );
}
