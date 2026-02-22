import React from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';

export interface UISettings {
  theme: 'sun' | 'moon' | 'universe';
  compactMode: boolean;
  showLineNumbers: boolean;
}

export function SettingsPanel(props: {
  settings: UISettings;
  onClose: () => void;
  onUpdate: (next: UISettings) => Promise<void>;
}) {
  const [activeRow, setActiveRow] = React.useState(0); // 0=theme, 1=layout

  useInput((ch, key) => {
    if (key.escape) props.onClose();
    if (key.tab) {
      setActiveRow((r) => (r === 0 ? 1 : 0));
    }
  });

  return (
    <Modal title="Settings" footer="Tab to Switch Section · Enter to Apply · Esc to Close">
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={activeRow === 0 ? 'cyan' : 'gray'} paddingX={1} flexDirection="column">
          <Text bold={activeRow === 0} color={activeRow === 0 ? 'cyan' : undefined}>
            [ {activeRow === 0 ? '●' : ' '} ] THEME
          </Text>
          {activeRow === 0 && (
            <SelectInput
              items={[
                { label: 'The Sun (Light)', value: 'sun' },
                { label: 'The Moon (Dark)', value: 'moon' },
                { label: 'The Universe (Vibrant)', value: 'universe' },
              ]}
              initialIndex={['sun', 'moon', 'universe'].indexOf(props.settings.theme)}
              onSelect={async (item) => {
                await props.onUpdate({ ...props.settings, theme: item.value as UISettings['theme'] });
              }}
            />
          )}
          {activeRow !== 0 && (
            <Text dimColor>  Current: {props.settings.theme.toUpperCase()}</Text>
          )}
        </Box>

        <Box borderStyle="round" borderColor={activeRow === 1 ? 'cyan' : 'gray'} paddingX={1} marginTop={1} flexDirection="column">
          <Text bold={activeRow === 1} color={activeRow === 1 ? 'cyan' : undefined}>
            [ {activeRow === 1 ? '●' : ' '} ] LAYOUT
          </Text>
          {activeRow === 1 && (
            <SelectInput
              items={[
                { label: `Compact mode: ${props.settings.compactMode ? 'ON' : 'OFF'}`, value: 'compact' },
                { label: `Line numbers: ${props.settings.showLineNumbers ? 'ON' : 'OFF'}`, value: 'lines' },
              ]}
              onSelect={async (item) => {
                if (item.value === 'compact') {
                  await props.onUpdate({ ...props.settings, compactMode: !props.settings.compactMode });
                }
                if (item.value === 'lines') {
                  await props.onUpdate({ ...props.settings, showLineNumbers: !props.settings.showLineNumbers });
                }
              }}
            />
          )}
          {activeRow !== 1 && (
            <Text dimColor>  Compact: {props.settings.compactMode ? 'ON' : 'OFF'} · Lines: {props.settings.showLineNumbers ? 'ON' : 'OFF'}</Text>
          )}
        </Box>
      </Box>
    </Modal>
  );
}
