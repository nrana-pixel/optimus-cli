/**
 * LLM Service
 * Handles interactions with OpenAI and Anthropic APIs
 * Supports streaming, error handling, and token tracking
 */

import { ConfigService } from './config.service.js';
import { Logger } from '../utils/logger.js';

export interface LLMResponse {
  content: string;
  model: string;
  provider: 'openai' | 'anthropic' | 'gemini';
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost: {
    input: number;
    output: number;
    total: number;
  };
  stopReason?: string;
}

export interface LLMStreamCallback {
  onChunk?: (chunk: string) => void;
  onComplete?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
}

export class LLMService {
  private apiKey: string;
  private provider: 'openai' | 'anthropic' | 'gemini';
  private model: string;

  // Pricing per 1M tokens (as of 2024)
  private static readonly PRICING = {
    openai: {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    },
    anthropic: {
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
    },
    gemini: {
      'gemini-2.5-flash': { input: 0.075, output: 0.3 },
      'gemini-2.0-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-pro': { input: 0.0075, output: 0.03 },
    },
  };

  constructor() {
    const config = ConfigService.loadConfig();
    this.provider = config.apiProvider as 'openai' | 'anthropic' | 'gemini';
    this.apiKey = ConfigService.getApiKey();

    // Set default model based on provider
    if (this.provider === 'openai') {
      this.model = 'gpt-3.5-turbo';
    } else if (this.provider === 'anthropic') {
      this.model = 'claude-3-haiku';
    } else if (this.provider === 'gemini') {
      this.model = 'gemini-2.5-flash';
    } else {
      throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Set the model to use
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Send a message and get a response
   */
  async complete(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    try {
      if (this.provider === 'openai') {
        return await this.completeOpenAI(message, systemPrompt, callbacks);
      } else if (this.provider === 'anthropic') {
        return await this.completeAnthropic(message, systemPrompt, callbacks);
      } else if (this.provider === 'gemini') {
        return await this.completeGemini(message, systemPrompt, callbacks);
      } else {
        throw new Error(`Unsupported provider: ${this.provider}`);
      }
    } catch (error) {
      if (callbacks?.onError) {
        callbacks.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * OpenAI API integration
   */
  private async completeOpenAI(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: message });

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: !!callbacks?.onChunk,
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw this.handleOpenAIError(response.status, error);
      }

      if (callbacks?.onChunk) {
        return await this.handleOpenAIStream(response, callbacks);
      } else {
        const data = await response.json();
        return this.parseOpenAIResponse(data);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`OpenAI API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Google Gemini API integration
   */
  private async completeGemini(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    try {
      // Use v1 API endpoint for better compatibility
      const url = `https://generativelanguage.googleapis.com/v1/models/${this.model}:generateContent?key=${this.apiKey}`;

      const parts: any[] = [];
      
      if (systemPrompt) {
        parts.push({ text: systemPrompt });
      }

      parts.push({ text: message });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts,
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw this.handleGeminiError(response.status, error);
      }

      const data = await response.json();
      return this.parseGeminiResponse(data);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Gemini API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Anthropic API integration
   */
  private async completeAnthropic(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
          stream: !!callbacks?.onChunk,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw this.handleAnthropicError(response.status, error);
      }

      if (callbacks?.onChunk) {
        return await this.handleAnthropicStream(response, callbacks);
      } else {
        const data = await response.json();
        return this.parseAnthropicResponse(data);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Handle OpenAI streaming response
   */
  private async handleOpenAIStream(
    response: Response,
    callbacks: LLMStreamCallback
  ): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const chunk = parsed.choices?.[0]?.delta?.content;
              if (chunk) {
                fullContent += chunk;
                if (callbacks.onChunk) {
                  callbacks.onChunk(chunk);
                }
              }

              // Track tokens
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens;
                outputTokens = parsed.usage.completion_tokens;
              }
            } catch (e) {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const cost = this.calculateCost(inputTokens, outputTokens);

    const llmResponse: LLMResponse = {
      content: fullContent,
      model: this.model,
      provider: 'openai',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      cost,
      stopReason: 'stop',
    };

    if (callbacks.onComplete) {
      callbacks.onComplete(llmResponse);
    }

    return llmResponse;
  }

  /**
   * Handle Anthropic streaming response
   */
  private async handleAnthropicStream(
    response: Response,
    callbacks: LLMStreamCallback
  ): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta') {
                const chunk = parsed.delta?.text;
                if (chunk) {
                  fullContent += chunk;
                  if (callbacks.onChunk) {
                    callbacks.onChunk(chunk);
                  }
                }
              }

              if (parsed.type === 'message_delta') {
                if (parsed.usage) {
                  outputTokens = parsed.usage.output_tokens;
                }
              }

              if (parsed.type === 'message_start') {
                if (parsed.message?.usage) {
                  inputTokens = parsed.message.usage.input_tokens;
                }
              }
            } catch (e) {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const cost = this.calculateCost(inputTokens, outputTokens);

    const llmResponse: LLMResponse = {
      content: fullContent,
      model: this.model,
      provider: 'anthropic',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      cost,
      stopReason: 'stop',
    };

    if (callbacks.onComplete) {
      callbacks.onComplete(llmResponse);
    }

    return llmResponse;
  }

  /**
   * Parse OpenAI non-streaming response
   */
  private parseOpenAIResponse(data: any): LLMResponse {
    const content = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content,
      model: this.model,
      provider: 'openai',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      cost,
      stopReason: data.choices?.[0]?.finish_reason,
    };
  }

  /**
   * Parse Gemini response
   */
  private parseGeminiResponse(data: any): LLMResponse {
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const inputTokens = data.usageMetadata?.promptTokenCount || 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content,
      model: this.model,
      provider: 'gemini',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      cost,
      stopReason: data.candidates?.[0]?.finishReason,
    };
  }

  /**
   * Parse Anthropic non-streaming response
   */
  private parseAnthropicResponse(data: any): LLMResponse {
    const content = data.content?.[0]?.text || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content,
      model: this.model,
      provider: 'anthropic',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      cost,
      stopReason: data.stop_reason,
    };
  }

  /**
   * Calculate cost based on tokens and pricing
   */
  private calculateCost(inputTokens: number, outputTokens: number): { input: number; output: number; total: number } {
    const pricing = (LLMService.PRICING as any)[this.provider]?.[this.model] || {
      input: 0.001,
      output: 0.001,
    };

    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;

    return {
      input: parseFloat(inputCost.toFixed(6)),
      output: parseFloat(outputCost.toFixed(6)),
      total: parseFloat((inputCost + outputCost).toFixed(6)),
    };
  }

  /**
   * Handle OpenAI API errors
   */
  private handleOpenAIError(status: number, error: any): Error {
    const message = error.error?.message || 'Unknown error';

    if (status === 429) {
      return new Error(`Rate limit exceeded: ${message}`);
    } else if (status === 401) {
      return new Error(`Invalid API key: ${message}`);
    } else if (status === 403) {
      return new Error(`Access forbidden: ${message}`);
    } else if (status === 500) {
      return new Error(`OpenAI server error: ${message}`);
    } else {
      return new Error(`OpenAI API error (${status}): ${message}`);
    }
  }

  /**
   * Handle Gemini API errors
   */
  private handleGeminiError(status: number, error: any): Error {
    const message = error.error?.message || error.message || 'Unknown error';

    if (status === 429) {
      return new Error(`Rate limit exceeded: ${message}`);
    } else if (status === 401) {
      return new Error(`Invalid API key: ${message}`);
    } else if (status === 403) {
      return new Error(`Access forbidden: ${message}`);
    } else if (status === 404) {
      return new Error(`Model not found: ${message}. Try using 'gemini-2.5-flash' or 'gemini-2.0-flash'`);
    } else if (status === 500) {
      return new Error(`Gemini server error: ${message}`);
    } else {
      return new Error(`Gemini API error (${status}): ${message}`);
    }
  }

  /**
   * Handle Anthropic API errors
   */
  private handleAnthropicError(status: number, error: any): Error {
    const message = error.error?.message || 'Unknown error';

    if (status === 429) {
      return new Error(`Rate limit exceeded: ${message}`);
    } else if (status === 401) {
      return new Error(`Invalid API key: ${message}`);
    } else if (status === 403) {
      return new Error(`Access forbidden: ${message}`);
    } else if (status === 500) {
      return new Error(`Anthropic server error: ${message}`);
    } else {
      return new Error(`Anthropic API error (${status}): ${message}`);
    }
  }

  /**
   * Get available models for current provider
   */
  getAvailableModels(): string[] {
    const models = (LLMService.PRICING as any)[this.provider];
    return models ? Object.keys(models) : [];
  }

  /**
   * Get pricing for a model
   */
  getPricing(model?: string): { input: number; output: number } {
    const m = model || this.model;
    return (LLMService.PRICING as any)[this.provider]?.[m] || {
      input: 0.001,
      output: 0.001,
    };
  }
}
