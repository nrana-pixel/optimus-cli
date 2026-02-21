import React from 'react';
import { render } from 'ink';
import { ChatUIController } from './runtime/ChatUIController.js';

export async function runChatUI() {
  const app = render(<ChatUIController />);
  await app.waitUntilExit();
}
