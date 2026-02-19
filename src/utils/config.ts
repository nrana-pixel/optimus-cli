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
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

export class Config {
  static getConfig(): AppConfig {
    return {
      apiKey: process.env.API_KEY || '',
      apiUrl: process.env.API_URL || 'https://api.example.com',
      debug: process.env.DEBUG === 'true',
      logLevel: process.env.LOG_LEVEL || 'info',
      dbHost: process.env.DB_HOST || 'localhost',
      dbPort: parseInt(process.env.DB_PORT || '5432', 10),
      dbName: process.env.DB_NAME || 'cli_project',
      dbUser: process.env.DB_USER || 'user',
      dbPassword: process.env.DB_PASSWORD || 'password',
    };
  }

  static get(key: keyof AppConfig): unknown {
    return this.getConfig()[key];
  }
}
