import { run } from '@oclif/core';

export async function main() {
  try {
    await run();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
