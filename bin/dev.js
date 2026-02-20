#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { run } from '@oclif/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = join(__dirname, '..');

// Default to "chat" command if no subcommand is given
const args = process.argv.slice(2);
if (args.length === 0 || (args.length > 0 && args[0].startsWith('-'))) {
  args.unshift('chat');
}

await run(args, {
  root,
});
