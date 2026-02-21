import React from 'react';
import { Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Modal } from './Modal.js';

export interface UISettings {
  theme: 'dark' | 'light' | 'high-contrast';
  compactMode: boolean;
  showLineNumbers: boolean;
}

export function SettingsPanel(props: {
  settings: UISettings;
  onClose: () => void;
  onUpdate: (next: UISettings) => Promise<void>;
}) {
  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  return (
    <Modal title="Settings" footer="Enter to apply. Esc closes.">
      <Text dimColor>Theme</Text>
      <SelectInput
        items={[
          { label: 'Dark', value: 'dark' },
          { label: 'Light', value: 'light' },
          { label: 'High contrast', value: 'high-contrast' },
        ]}
        onSelect={async (item) => {
          await props.onUpdate({ ...props.settings, theme: item.value as UISettings['theme'] });
        }}
      />

      <Text dimColor>Layout</Text>
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
    </Modal>
  );
}
