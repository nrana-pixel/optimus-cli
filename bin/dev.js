#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { run } from '@oclif/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = join(__dirname, '..');

// Intelligent command routing
const args = process.argv.slice(2);
const knownCommands = ['analyze', 'chat', 'clear', 'code', 'config', 'hello', 'init', 'local-model', 'status', 'version', 'help'];

if (args.length === 0) {
  // Default to interactive chat if no arguments
  args.unshift('chat');
} else if (args.length > 0 && !args[0].startsWith('-') && !knownCommands.includes(args[0])) {
  // If the first argument is text (not a known command or flag), pass it to the chat UI
  args.unshift('chat');
} else if (args.length > 0 && args[0].startsWith('-') && !knownCommands.some(c => args.includes(c))) {
  // If they only pass flags (like -m), default to chat
  args.unshift('chat');
}

await run(args, {
  root,
});
