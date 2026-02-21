import React from 'react';
import { render } from 'ink';
import { ChatUIController } from './runtime/ChatUIController.js';

export async function runChatUI(initialPrompt?: string) {
  const app = render(<ChatUIController initialPrompt={initialPrompt} />);
  await app.waitUntilExit();
}
