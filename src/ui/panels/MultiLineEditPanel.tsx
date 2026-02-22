import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useTheme } from '../Theme.js';
import { Modal } from './Modal.js';

export function MultiLineEditPanel(props: {
    initialValue: string;
    onClose: () => void;
    onSubmit: (text: string) => void;
}) {
    const theme = useTheme();
    const [value, setValue] = useState(props.initialValue);

    useInput((input, key) => {
        if (key.escape) props.onClose();
        if (key.ctrl && input === 's') props.onSubmit(value);
    });

    return (
        <Modal title="Multi-line Edit Mode" footer="Ctrl+S to Submit · Esc to Cancel">
            <Box flexDirection="column" minHeight={10} width="100%">
                <Text color={theme.text as any}>
                    <TextInput
                        value={value}
                        onChange={setValue}
                        focus
                        placeholder="Type your multi-line prompt here..."
                    />
                </Text>
            </Box>
        </Modal>
    );
}
