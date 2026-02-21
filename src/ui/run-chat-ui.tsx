import React from 'react';
import { render } from 'ink';
import { ChatUIController } from './runtime/ChatUIController.js';

export async function runChatUI() {
  // Write ANSI exact clear + alt screen to prevent rendering ghost lines
  process.stdout.write('\x1b[?1049h');

  const app = render(<ChatUIController />);
  await app.waitUntilExit();

  // Restore main screen buffer
  process.stdout.write('\x1b[?1049l');
}
