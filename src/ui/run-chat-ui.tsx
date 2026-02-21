import React from 'react';
import { render } from 'ink';
import { ChatUIController } from './runtime/ChatUIController.js';

export async function runChatUI() {
  render(<ChatUIController />);
}
