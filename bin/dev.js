#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { run } from '@oclif/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = join(__dirname, '..');

await run(process.argv.slice(2), {
  root,
});
