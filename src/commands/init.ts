import { Command } from '@oclif/core';
import prompts from 'prompts';
import { ConfigService } from '../services/config.service.js';
import { Logger } from '../utils/logger.js';

export default class Init extends Command {
  static override description = 'Initialize a new multi-agent workspace';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    this.log('\n🚀 Multi-Agent Workspace Initialization\n');

    // Check if already initialized
    if (ConfigService.isInitialized()) {
      this.log('⚠️  Workspace already initialized at: ' + ConfigService.getConfigFile());
      const response = await prompts({
        type: 'confirm',
        name: 'reinitialize',
        message: 'Do you want to reinitialize?',
        initial: false,
      });

      if (!response.reinitialize) {
        this.log('Initialization cancelled.');
        return;
      }
    }

    try {
      // Prompt for workspace name
      const nameResponse = await prompts({
        type: 'text',
        name: 'workspaceName',
        message: 'Workspace name',
        initial: 'my-workspace',
        validate: (value: string) => {
          if (!value || value.trim().length === 0) {
            return 'Workspace name cannot be empty';
          }
          if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
            return 'Workspace name can only contain letters, numbers, hyphens, and underscores';
          }
          return true;
        },
      });

      if (!nameResponse.workspaceName) {
        this.log('Initialization cancelled.');
        return;
      }

      // Prompt for API provider
      const providerResponse = await prompts({
        type: 'select',
        name: 'apiProvider',
        message: 'Select API provider',
        choices: [
          { title: 'OpenAI', value: 'openai' },
          { title: 'Anthropic', value: 'anthropic' },
          { title: 'Google Gemini', value: 'gemini' },
        ],
        initial: 0,
      });

      if (!providerResponse.apiProvider) {
        this.log('Initialization cancelled.');
        return;
      }

      // Prompt for API key
      const keyResponse = await prompts({
        type: 'password',
        name: 'apiKey',
        message: `Enter your ${this.getProviderDisplayName(providerResponse.apiProvider)} API key`,
        validate: (value: string) => {
          if (!ConfigService.validateApiKey(value, providerResponse.apiProvider)) {
            return `Invalid ${this.getProviderDisplayName(providerResponse.apiProvider)} API key format`;
          }
          return true;
        },
      });

      if (!keyResponse.apiKey) {
        this.log('Initialization cancelled.');
        return;
      }

      // Initialize workspace
      this.log('\n⏳ Initializing workspace...\n');

      const config = ConfigService.initializeWorkspace(
        nameResponse.workspaceName,
        providerResponse.apiProvider,
        keyResponse.apiKey
      );

      // Create workspace directory structure
      ConfigService.createWorkspaceStructure(nameResponse.workspaceName);

      // Success message
      this.log('✅ Workspace initialized successfully!\n');
      this.log('📁 Configuration saved to: ' + ConfigService.getConfigFile());
      this.log('📦 Workspace name: ' + config.workspaceName);
      this.log('🔑 API Provider: ' + this.getProviderDisplayName(config.apiProvider));
      this.log('🔐 API Key: ' + (keyResponse.apiKey.substring(0, 7) + '***'));
      this.log('📅 Created at: ' + config.createdAt);

      this.log('\n📚 Next steps:');
      this.log('  1. Start chatting: optimus chat');
      this.log('  2. Run a coding task: optimus code "your task"');
      this.log('  3. Analyze your project: optimus analyze');
      this.log('  4. Manage config: optimus config\n');
    } catch (error) {
      Logger.error('Initialization failed: ' + (error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  private getProviderDisplayName(provider: 'openai' | 'anthropic' | 'gemini'): string {
    switch (provider) {
      case 'openai':
        return 'OpenAI';
      case 'anthropic':
        return 'Anthropic';
      case 'gemini':
        return 'Google Gemini';
      default:
        return provider;
    }
  }
}
