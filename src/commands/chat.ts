import { Command, Flags } from '@oclif/core';

/**
 * Chat command
 *
 * Ink UI is the only supported UI. The actual chat engine lives in
 * `src/chat/chat-engine.ts` and is used by the Ink runtime.
 */
export default class Chat extends Command {
  static id = 'chat';
  static description = 'Optimus Chat — AI Coding Agent';

  static flags = {
    model: Flags.string({ char: 'm', description: 'Model to use (overrides config default)' }),
  };

  async run() {
    // Parse flags for forward-compatibility (model override wiring can be added to ChatEngine later)
    await this.parse(Chat);

    const { runChatUI } = await import('../ui/run-chat-ui.js');
    await runChatUI();
  }
}
