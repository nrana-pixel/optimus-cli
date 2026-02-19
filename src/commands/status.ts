import { Command } from '@oclif/core';
import { ConfigService } from '../services/config.service.js';

export default class Status extends Command {
  static override description = 'Check workspace initialization status';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.log('\n📊 Workspace Status\n');

    if (!ConfigService.isInitialized()) {
      this.log('❌ Workspace not initialized');
      this.log('\nRun the following command to initialize:');
      this.log('  cli-project init\n');
      return;
    }

    try {
      const config = ConfigService.loadConfig();

      this.log('✅ Workspace initialized');
      this.log('\n📋 Configuration:');
      this.log('  Workspace Name: ' + config.workspaceName);
      this.log('  API Provider: ' + config.apiProvider.toUpperCase());
      this.log('  Created At: ' + new Date(config.createdAt).toLocaleString());
      this.log('  Config File: ' + ConfigService.getConfigFile());
      this.log('  Config Dir: ' + ConfigService.getConfigDir());
      this.log('\n');
    } catch (error) {
      this.log('❌ Error reading configuration: ' + (error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }
}
