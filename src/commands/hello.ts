import { Command, Flags } from '@oclif/core';

export default class Hello extends Command {
  static override description = 'Say hello to someone';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --name World',
  ];

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'Name to greet',
      default: 'World',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Hello);
    this.log(`Hello again ${flags.name}!`);
  }
}
