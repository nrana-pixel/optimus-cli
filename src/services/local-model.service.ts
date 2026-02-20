/**
 * Local Model Service
 * Handles interactions with local models running on localhost, ngrok, cloudflare, or other tunneling services
 * Supports Ollama, OpenAI-compatible, and generic HTTP endpoints
 */

import type { LocalModel, LocalModelTestResult, LocalModelResponse } from '../types/local-model.js';

export interface LLMStreamCallback {
  onChunk?: (chunk: string) => void;
  onComplete?: (response: LocalModelResponse) => void;
  onError?: (error: Error) => void;
}

export class LocalModelService {
  private model: LocalModel;
  private testTimeout: number = 30000;       // 30s for probes/tests
  private completionTimeout: number = 300000; // 5 min for actual completions

  constructor(model: LocalModel) {
    this.model = model;
  }

  /**
   * Test if the local model endpoint is accessible and working
   */
  async testEndpoint(): Promise<LocalModelTestResult> {
    try {
      const startTime = Date.now();

      if (this.model.type === 'ollama') {
        return await this.testOllamaEndpoint(startTime);
      } else if (this.model.type === 'openai-compatible') {
        return await this.testOpenAICompatibleEndpoint(startTime);
      } else {
        return await this.testGenericEndpoint(startTime);
      }
    } catch (error) {
      return {
        success: false,
        message: `Endpoint test failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Test Ollama endpoint
   */
  private async testOllamaEndpoint(startTime: number): Promise<LocalModelTestResult> {
    try {
      const response = await fetch(`${this.model.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.completionTimeout),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Ollama endpoint returned status ${response.status}`,
        };
      }

      const data = await response.json() as any;
      const latency = Date.now() - startTime;

      const models: any[] = data.models || [];
      const modelName = this.model.model || 'unknown';
      const modelExists = models.some((m: any) => m.name === modelName || m.name.startsWith(modelName));

      if (!modelExists && models.length > 0) {
        return {
          success: true,
          message: `Ollama endpoint is working. Available models: ${models.map((m: any) => m.name).join(', ')}`,
          latency,
          modelInfo: {
            name: 'Ollama',
            capabilities: ['chat', 'completion'],
          },
        };
      }

      return {
        success: true,
        message: `Ollama endpoint is working with model '${modelName}'`,
        latency,
        modelInfo: {
          name: 'Ollama',
          capabilities: ['chat', 'completion'],
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to connect to Ollama endpoint: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Test OpenAI-compatible endpoint
   */
  private async testOpenAICompatibleEndpoint(startTime: number): Promise<LocalModelTestResult> {
    try {
      const messages = [{ role: 'user', content: 'Hello' }];
      const modelName = this.model.model || 'default';

      const response = await fetch(`${this.model.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.model.apiKey && { Authorization: `Bearer ${this.model.apiKey}` }),
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          max_tokens: 10,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(this.completionTimeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        return {
          success: false,
          message: `OpenAI-compatible endpoint returned status ${response.status}: ${errorData.error?.message || 'Unknown error'}`,
        };
      }

      const latency = Date.now() - startTime;

      return {
        success: true,
        message: `OpenAI-compatible endpoint is working with model '${modelName}'`,
        latency,
        modelInfo: {
          name: modelName,
          capabilities: ['chat', 'completion'],
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to connect to OpenAI-compatible endpoint: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Test generic HTTP endpoint
   */
  private async testGenericEndpoint(startTime: number): Promise<LocalModelTestResult> {
    try {
      const response = await fetch(this.model.endpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(this.completionTimeout),
      });

      const latency = Date.now() - startTime;

      if (response.ok) {
        return {
          success: true,
          message: `Generic endpoint is accessible`,
          latency,
        };
      } else {
        return {
          success: false,
          message: `Generic endpoint returned status ${response.status}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to connect to generic endpoint: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Send a message to the local model
   */
  async complete(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LocalModelResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: message });

    return this.completeWithHistory(messages, callbacks);
  }

  /**
   * Send a full message history to the local model
   */
  async completeWithHistory(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback
  ): Promise<LocalModelResponse> {
    try {
      if (this.model.type === 'ollama') {
        return await this.completeOllama(messages, callbacks);
      } else if (this.model.type === 'openai-compatible') {
        return await this.completeOpenAICompatible(messages, callbacks);
      } else {
        throw new Error(`Unsupported local model type: ${this.model.type}`);
      }
    } catch (error) {
      if (callbacks?.onError) {
        callbacks.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Complete with Ollama endpoint
   */
  private async completeOllama(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback
  ): Promise<LocalModelResponse> {
    const modelName = this.model.model || 'llama2';

    try {
      const response = await fetch(`${this.model.endpoint}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: false,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(this.completionTimeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`Ollama API error: ${errorData.error || response.statusText}`);
      }

      const data = await response.json() as any;
      const content: string = data.message?.content || '';

      if (callbacks?.onChunk) {
        callbacks.onChunk(content);
      }

      const result: LocalModelResponse = {
        content,
        model: modelName,
        tokensUsed: {
          input: data.prompt_eval_count || 0,
          output: data.eval_count || 0,
          total: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
      };

      if (callbacks?.onComplete) {
        callbacks.onComplete(result);
      }

      return result;
    } catch (error) {
      throw new Error(`Ollama completion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Complete with OpenAI-compatible endpoint
   */
  private async completeOpenAICompatible(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback
  ): Promise<LocalModelResponse> {
    const modelName = this.model.model || 'default';

    try {
      const response = await fetch(`${this.model.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.model.apiKey && { Authorization: `Bearer ${this.model.apiKey}` }),
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature: 0.7,
          max_tokens: 2000,
          stream: false,
        }),
        signal: AbortSignal.timeout(this.completionTimeout),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`OpenAI-compatible API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      const content: string = data.choices?.[0]?.message?.content || '';
      const inputTokens: number = data.usage?.prompt_tokens || 0;
      const outputTokens: number = data.usage?.completion_tokens || 0;

      if (callbacks?.onChunk) {
        callbacks.onChunk(content);
      }

      const result: LocalModelResponse = {
        content,
        model: modelName,
        tokensUsed: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
      };

      if (callbacks?.onComplete) {
        callbacks.onComplete(result);
      }

      return result;
    } catch (error) {
      throw new Error(`OpenAI-compatible completion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the model information
   */
  getModel(): LocalModel {
    return this.model;
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return this.model.model || this.model.name;
  }
}
