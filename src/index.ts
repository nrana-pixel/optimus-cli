import { run } from '@oclif/core';

export async function main() {
  try {
    const args = process.argv.slice(2);
    const knownCommands = ['analyze', 'chat', 'clear', 'code', 'config', 'hello', 'init', 'local-model', 'status', 'version', 'help'];

    if (args.length === 0) {
      args.unshift('chat');
    } else if (args.length > 0 && !args[0].startsWith('-') && !knownCommands.includes(args[0])) {
      args.unshift('chat');
    } else if (args.length > 0 && args[0].startsWith('-') && !knownCommands.some(c => args.includes(c))) {
      args.unshift('chat');
    }

    await run(args);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
