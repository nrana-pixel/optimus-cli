/**
 * Configuration Utility
 * Loads and manages environment variables
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export interface AppConfig {
  apiKey: string;
  apiUrl: string;
  debug: boolean;
  logLevel: string;
}

export class Config {
  static getConfig(): AppConfig {
    return {
      apiKey: process.env.API_KEY || '',
      apiUrl: process.env.API_URL || 'https://api.example.com',
      debug: process.env.DEBUG === 'true',
      logLevel: process.env.LOG_LEVEL || 'info',
    };
  }

  static get(key: keyof AppConfig): unknown {
    return this.getConfig()[key];
  }
}

