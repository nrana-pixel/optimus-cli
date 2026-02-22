import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

export function Typewriter(props: { text: string; speed?: number; onComplete?: () => void }) {
    const { text, speed = 15, onComplete } = props;
    const [displayedText, setDisplayedText] = useState('');
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (index < text.length) {
            const timeout = setTimeout(() => {
                setDisplayedText((prev) => prev + text[index]);
                setIndex((prev) => prev + 1);
            }, speed);
            return () => clearTimeout(timeout);
        } else {
            onComplete?.();
        }
    }, [index, text, speed, onComplete]);

    return <Text>{displayedText}</Text>;
}
