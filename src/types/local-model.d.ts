/**
 * Local Model Type Definitions
 * Supports local models running on localhost, ngrok, cloudflare, or other tunneling services
 */

export interface LocalModel {
  id: string;                    // Unique identifier (e.g., 'ollama-llama2')
  name: string;                  // Display name (e.g., 'Ollama Llama 2')
  endpoint: string;              // Full URL to the model endpoint
  type: 'ollama' | 'openai-compatible' | 'generic'; // API type
  model?: string;                // Model name/ID on the endpoint (e.g., 'llama2')
  apiKey?: string;               // Optional API key for authentication
  description?: string;          // User-friendly description
  createdAt: string;             // ISO timestamp
  lastTested?: string;           // ISO timestamp of last successful test
  isHealthy?: boolean;           // Last known health status
  tunnelType?: 'ngrok' | 'cloudflare' | 'localhost' | 'other'; // How it's exposed
}

export interface LocalModelConfig {
  models: LocalModel[];
  defaultLocalModel?: string;    // ID of default local model
}

export interface LocalModelTestResult {
  success: boolean;
  message: string;
  latency?: number;              // Response time in ms
  modelInfo?: {
    name?: string;
    version?: string;
    capabilities?: string[];
  };
}

export interface LocalModelRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface LocalModelResponse {
  content: string;
  model: string;
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  stopReason?: string;
}
