import React from 'react';
import { render } from 'ink';
import { ChatUIController } from './runtime/ChatUIController.js';

export async function runChatUI() {
  // Write ANSI exact clear + alt screen to prevent rendering ghost lines
  process.stdout.write('\x1b[?1049h');

  try {
    const app = render(<ChatUIController />);
    await app.waitUntilExit();
  } finally {
    // Restore main screen buffer even on crashes
    process.stdout.write('\x1b[?1049l');
  }
}
