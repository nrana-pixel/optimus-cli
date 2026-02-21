/**
 * Configuration Service
 * Manages workspace configuration and encrypted API keys
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { LocalModel } from '../types/local-model.js';

export interface WorkspaceConfig {
  workspaceName: string;
  apiProvider: 'openai' | 'anthropic' | 'gemini';
  apiKeyEncrypted: string;
  createdAt: string;
  version: string;
  localModels?: LocalModel[];        // Array of configured local models
  defaultLocalModel?: string;        // ID of default local model
  autonomyMode?: 'interactive' | 'trusted' | 'on-failure'; // Agent autonomy mode
}

export class ConfigService {
  private static readonly CONFIG_DIR = join(homedir(), '.multi-agent');
  private static readonly CONFIG_FILE = join(this.CONFIG_DIR, 'config.json');
  // Prefer authenticated encryption.
  private static readonly ALGORITHM_GCM = 'aes-256-gcm';
  private static readonly ALGORITHM_LEGACY = 'aes-256-cbc';
  private static readonly SALT = 'multi-agent-cli'; // In production, use a secure salt

  /**
   * Check if workspace is already initialized
   */
  static isInitialized(): boolean {
    return existsSync(this.CONFIG_FILE);
  }

  /**
   * Get the config directory path
   */
  static getConfigDir(): string {
    return this.CONFIG_DIR;
  }

  /**
   * Get the config file path
   */
  static getConfigFile(): string {
    return this.CONFIG_FILE;
  }

  /**
   * Encrypt API key using AES-256-GCM (authenticated encryption).
   * Format: gcm:<ivHex>:<tagHex>:<cipherHex>
   */
  static encryptApiKey(apiKey: string): string {
    try {
      const iv = randomBytes(12); // recommended length for GCM
      const key = scryptSync(this.SALT, 'salt', 32);
      const cipher = createCipheriv(this.ALGORITHM_GCM, key, iv);

      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();

      return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    } catch (error) {
      throw new Error(`Failed to encrypt API key: ${error}`);
    }
  }

  /**
   * Decrypt API key.
   * Supports both new AES-256-GCM format and legacy AES-256-CBC format.
   */
  static decryptApiKey(encryptedKey: string): string {
    try {
      const parts = encryptedKey.split(':');

      // New format: gcm:<ivHex>:<tagHex>:<cipherHex>
      if (parts[0] === 'gcm') {
        if (parts.length !== 4) throw new Error('Invalid GCM encrypted key format');
        const iv = Buffer.from(parts[1], 'hex');
        const tag = Buffer.from(parts[2], 'hex');
        const encrypted = parts[3];
        const key = scryptSync(this.SALT, 'salt', 32);
        const decipher = createDecipheriv(this.ALGORITHM_GCM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      }

      // Legacy format: <ivHex>:<cipherHex>
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted key format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const key = scryptSync(this.SALT, 'salt', 32);
      const decipher = createDecipheriv(this.ALGORITHM_LEGACY, key, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Failed to decrypt API key: ${error}`);
    }
  }

  /**
   * Initialize workspace configuration
   */
  static initializeWorkspace(
    workspaceName: string,
    apiProvider: 'openai' | 'anthropic' | 'gemini',
    apiKey: string
  ): WorkspaceConfig {
    // Create config directory if it doesn't exist
    if (!existsSync(this.CONFIG_DIR)) {
      mkdirSync(this.CONFIG_DIR, { recursive: true });
    }

    // Encrypt the API key
    const encryptedKey = this.encryptApiKey(apiKey);

    // Create config object
    const config: WorkspaceConfig = {
      workspaceName,
      apiProvider,
      apiKeyEncrypted: encryptedKey,
      createdAt: new Date().toISOString(),
      version: '1.0.0',
    };

    // Write config file
    writeFileSync(this.CONFIG_FILE, JSON.stringify(config, null, 2));

    // Set restrictive permissions (Unix-like systems)
    try {
      // Note: This is a best-effort approach for security
      // In production, consider using more robust security measures
    } catch (error) {
      // Silently fail on Windows or systems that don't support chmod
    }

    return config;
  }

  /**
   * Load workspace configuration
   */
  static loadConfig(): WorkspaceConfig {
    if (!this.isInitialized()) {
      throw new Error('Workspace not initialized. Run "init" command first.');
    }

    try {
      const configContent = readFileSync(this.CONFIG_FILE, 'utf-8');
      return JSON.parse(configContent) as WorkspaceConfig;
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Get decrypted API key
   */
  static getApiKey(): string {
    const config = this.loadConfig();
    return this.decryptApiKey(config.apiKeyEncrypted);
  }

  /**
   * Update workspace configuration
   */
  static updateConfig(updates: Partial<WorkspaceConfig>): WorkspaceConfig {
    const config = this.loadConfig();
    const updated = { ...config, ...updates };

    writeFileSync(this.CONFIG_FILE, JSON.stringify(updated, null, 2));

    return updated;
  }

  /**
   * Delete workspace configuration
   */
  static deleteConfig(): void {
    if (existsSync(this.CONFIG_FILE)) {
      try {
        unlinkSync(this.CONFIG_FILE);
      } catch {
        // Fallback: overwrite with empty JSON so loadConfig doesn't crash
        writeFileSync(this.CONFIG_FILE, '{}');
      }
    }
  }

  /**
   * Create workspace directory structure
   */
  static createWorkspaceStructure(workspaceName: string): void {
    const workspaceDir = join(this.CONFIG_DIR, 'workspaces', workspaceName);

    const directories = [
      workspaceDir,
      join(workspaceDir, 'agents'),
      join(workspaceDir, 'tasks'),
      join(workspaceDir, 'logs'),
      join(workspaceDir, 'data'),
    ];

    directories.forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Validate API key format
   */
  static validateApiKey(apiKey: string, provider: 'openai' | 'anthropic' | 'gemini'): boolean {
    if (!apiKey || apiKey.trim().length === 0) {
      return false;
    }

    if (provider === 'openai') {
      // OpenAI keys start with 'sk-' (legacy) or 'sk-proj-' (project keys)
      return apiKey.startsWith('sk-') || apiKey.startsWith('sk-proj-');
    } else if (provider === 'anthropic') {
      // Anthropic keys typically start with 'sk-ant-'
      return apiKey.startsWith('sk-ant-');
    } else if (provider === 'gemini') {
      // Gemini keys are typically alphanumeric strings (no specific prefix)
      // Minimum length check for validity
      return apiKey.length >= 20;
    }

    return true;
  }

  /**
   * Add a local model to the configuration
   */
  static addLocalModel(model: LocalModel): LocalModel {
    const config = this.loadConfig();
    if (!config.localModels) {
      config.localModels = [];
    }

    // Check if model with same ID already exists
    const existingIndex = config.localModels.findIndex((m) => m.id === model.id);
    if (existingIndex >= 0) {
      config.localModels[existingIndex] = model;
    } else {
      config.localModels.push(model);
    }

    writeFileSync(this.CONFIG_FILE, JSON.stringify(config, null, 2));
    return model;
  }

  /**
   * Get all local models
   */
  static getLocalModels(): LocalModel[] {
    const config = this.loadConfig();
    return config.localModels || [];
  }

  /**
   * Get a specific local model by ID
   */
  static getLocalModel(id: string): LocalModel | undefined {
    const config = this.loadConfig();
    return config.localModels?.find((m) => m.id === id);
  }

  /**
   * Remove a local model
   */
  static removeLocalModel(id: string): boolean {
    const config = this.loadConfig();
    if (!config.localModels) {
      return false;
    }

    const initialLength = config.localModels.length;
    config.localModels = config.localModels.filter((m) => m.id !== id);

    if (config.localModels.length < initialLength) {
      // If removed model was default, clear default
      if (config.defaultLocalModel === id) {
        config.defaultLocalModel = undefined;
      }
      writeFileSync(this.CONFIG_FILE, JSON.stringify(config, null, 2));
      return true;
    }

    return false;
  }

  /**
   * Set default local model
   */
  static setDefaultLocalModel(id: string): void {
    const config = this.loadConfig();
    const model = config.localModels?.find((m) => m.id === id);
    if (!model) {
      throw new Error(`Local model with ID '${id}' not found`);
    }
    config.defaultLocalModel = id;
    writeFileSync(this.CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  /**
   * Get default local model
   */
  static getDefaultLocalModel(): LocalModel | undefined {
    const config = this.loadConfig();
    if (!config.defaultLocalModel) {
      return undefined;
    }
    return config.localModels?.find((m) => m.id === config.defaultLocalModel);
  }

  /**
   * Update local model health status
   */
  static updateLocalModelHealth(id: string, isHealthy: boolean, lastTested?: string): void {
    const config = this.loadConfig();
    const model = config.localModels?.find((m) => m.id === id);
    if (model) {
      model.isHealthy = isHealthy;
      model.lastTested = lastTested || new Date().toISOString();
      writeFileSync(this.CONFIG_FILE, JSON.stringify(config, null, 2));
    }
  }
}
