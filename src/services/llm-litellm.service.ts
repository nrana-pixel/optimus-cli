// @ts-nocheck
/**
 * LLM Service with LiteLLM (OPTIONAL)
 * Alternative implementation using LiteLLM for unified API access
 * Supports OpenAI, Anthropic, and Google Gemini
 * 
 * INSTALLATION REQUIRED:
 * pnpm add litellm
 * 
 * Usage:
 * import { LLMServiceLiteLLM } from './llm-litellm.service.js';
 * const llm = new LLMServiceLiteLLM();
 * const response = await llm.complete('Your prompt');
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

export class LLMServiceLiteLLM {
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

    // Set environment variables for LiteLLM
    this.setupLiteLLMEnv();
  }

  /**
   * Setup environment variables for LiteLLM
   */
  private setupLiteLLMEnv(): void {
    if (this.provider === 'openai') {
      process.env.OPENAI_API_KEY = this.apiKey;
    } else if (this.provider === 'anthropic') {
      process.env.ANTHROPIC_API_KEY = this.apiKey;
    } else if (this.provider === 'gemini') {
      process.env.GOOGLE_API_KEY = this.apiKey;
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
   * Send a message and get a response using LiteLLM
   * 
   * Note: This requires litellm to be installed:
   * pnpm add litellm
   */
  async complete(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: message });
    return this.completeWithHistory(messages, callbacks);
  }

  /**
   * Send a full message history and get a response (multi-turn chat)
   */
  async completeWithHistory(
    messages: Array<{ role: string; content: string | any[] }>,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    // The JS litellm package does not support Gemini — use native REST for it
    if (this.provider === 'gemini') {
      return this.completeGeminiNative(messages, callbacks);
    }

    try {
      let litellm;
      try {
        litellm = await import('litellm');
      } catch (error) {
        const errorMsg = 'LiteLLM is not installed. Install it with: pnpm add litellm';
        if (callbacks?.onError) callbacks.onError(new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const modelString = this.buildLiteLLMModelString();

      let response;
      try {
        response = await litellm.completion({
          model: modelString,
          messages,
          temperature: 0.7,
          max_tokens: 4096,
          stream: false,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (callbacks?.onError) callbacks.onError(new Error(errorMsg));
        throw error;
      }

      const parsed = this.parseLiteLLMResponse(response);

      if (callbacks?.onChunk) callbacks.onChunk(parsed.content);
      if (callbacks?.onComplete) callbacks.onComplete(parsed);

      return parsed;
    } catch (error) {
      if (callbacks?.onError) callbacks.onError(error as Error);
      throw error;
    }
  }

  /**
   * Native Gemini REST API call with multi-turn history support.
   * Converts the OpenAI-style messages array into Gemini's `contents` format.
   */
  private async completeGeminiNative(
    messages: Array<{ role: string; content: string | any[] }>,
    callbacks?: LLMStreamCallback
  ): Promise<LLMResponse> {
    try {
      // Separate system prompt (first message if role === 'system')
      let systemInstruction: string | undefined;
      let chatMessages = messages;

      if (messages.length > 0 && messages[0].role === 'system') {
        const sysMsg = messages[0].content;
        systemInstruction = Array.isArray(sysMsg) 
          ? sysMsg.filter(c => c.type === 'text').map(c => c.text).join('\n') 
          : sysMsg;
        chatMessages = messages.slice(1);
      }

      // Convert to Gemini contents format (user → model alternation)
      const contents = chatMessages.map((m) => {
        let parts: any[] = [];
        if (typeof m.content === 'string') {
          parts = [{ text: m.content }];
        } else if (Array.isArray(m.content)) {
          parts = m.content.map(c => {
            if (c.type === 'text') return { text: c.text };
            if (c.type === 'image_url') {
              const match = c.image_url?.url?.match(/^data:(image\/[a-z]+);base64,(.*)$/);
              if (match) {
                return { inlineData: { mimeType: match[1], data: match[2] } };
              }
            }
            return { text: JSON.stringify(c) };
          });
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const body: any = {
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
      };

      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json();
        const msg = errData?.error?.message || `HTTP ${response.status}`;
        if (callbacks?.onError) callbacks.onError(new Error(msg));
        throw new Error(`Gemini API error: ${msg}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const inputTokens  = data.usageMetadata?.promptTokenCount     || 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
      const cost = this.calculateCost(inputTokens, outputTokens);

      const result: LLMResponse = {
        content,
        model: this.model,
        provider: 'gemini',
        tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        cost,
        stopReason: data.candidates?.[0]?.finishReason,
      };

      if (callbacks?.onChunk) callbacks.onChunk(content);
      if (callbacks?.onComplete) callbacks.onComplete(result);

      return result;
    } catch (error) {
      if (callbacks?.onError) callbacks.onError(error as Error);
      throw error;
    }
  }

  /**
   * Build LiteLLM model string
   * LiteLLM uses format: "provider/model-name"
   */
  private buildLiteLLMModelString(): string {
    switch (this.provider) {
      case 'openai':
        return `openai/${this.model}`;
      case 'anthropic':
        return `anthropic/${this.model}`;
      case 'gemini':
        return `gemini/${this.model}`;
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Parse LiteLLM response
   */
  private parseLiteLLMResponse(data: any): LLMResponse {
    const content = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const cost = this.calculateCost(inputTokens, outputTokens);

    return {
      content,
      model: this.model,
      provider: this.provider,
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
   * Calculate cost based on tokens and pricing
   */
  private calculateCost(inputTokens: number, outputTokens: number): { input: number; output: number; total: number } {
    const pricing = (LLMServiceLiteLLM.PRICING as any)[this.provider]?.[this.model] || {
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
   * Get available models for current provider
   */
  getAvailableModels(): string[] {
    const models = (LLMServiceLiteLLM.PRICING as any)[this.provider];
    return models ? Object.keys(models) : [];
  }

  /**
   * Get pricing for a model
   */
  getPricing(model?: string): { input: number; output: number } {
    const m = model || this.model;
    return (LLMServiceLiteLLM.PRICING as any)[this.provider]?.[m] || {
      input: 0.001,
      output: 0.001,
    };
  }
}
