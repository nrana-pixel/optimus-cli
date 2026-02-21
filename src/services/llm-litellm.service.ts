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
  toolCalls?: Array<{ id: string; name: string; args: any }>;
}

export interface LLMStreamCallback {
  onChunk?: (chunk: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; args: any }) => void;
  onComplete?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
}

export class LLMServiceLiteLLM {
  private apiKey: string;
  private provider: 'openai' | 'anthropic' | 'gemini';
  private model: string;

  // Pricing per 1M tokens (updated 2025)
  private static readonly PRICING: Record<string, Record<string, { input: number; output: number }>> = {
    openai: {
      'gpt-4': { input: 30, output: 60 },
      'gpt-4-turbo': { input: 10, output: 30 },
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    },
    anthropic: {
      'claude-3-opus': { input: 15, output: 75 },
      'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
      'claude-3-sonnet': { input: 3, output: 15 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
    },
    gemini: {
      'gemini-2.5-flash': { input: 0.075, output: 0.3 },
      'gemini-2.0-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-pro': { input: 1.25, output: 5 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    },
  };

  constructor() {
    const config = ConfigService.loadConfig();
    this.provider = config.apiProvider as 'openai' | 'anthropic' | 'gemini';
    this.apiKey = ConfigService.getApiKey();

    // Read defaultModel from config, fall back to provider defaults
    const defaultModel = (config as any).defaultModel;

    if (defaultModel) {
      this.model = defaultModel;
    } else if (this.provider === 'openai') {
      this.model = 'gpt-4o-mini';
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
   */
  async complete(
    message: string,
    systemPrompt?: string,
    callbacks?: LLMStreamCallback,
    tools?: any[]
  ): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: message });
    return this.completeWithHistory(messages, callbacks, tools);
  }

  /**
   * Send a full message history and get a response (multi-turn chat)
   */
  async completeWithHistory(
    messages: Array<{ role: string; content: string | any[] }>,
    callbacks?: LLMStreamCallback,
    tools?: any[]
  ): Promise<LLMResponse> {
    // Use native REST for Gemini (the JS litellm package does not support it well)
    if (this.provider === 'gemini') {
      return this.completeGeminiNative(messages, callbacks, tools);
    }

    try {
      let litellm: any;
      try {
        litellm = await import('litellm');
      } catch (error) {
        const errorMsg = 'LiteLLM is not installed. Install it with: pnpm add litellm';
        if (callbacks?.onError) callbacks.onError(new Error(errorMsg));
        throw new Error(errorMsg);
      }

      const modelString = this.buildLiteLLMModelString();

      let response: any;
      try {
        if (callbacks?.onChunk) {
          // Streaming mode
          const args: any = {
            model: modelString,
            messages,
            temperature: 0.7,
            max_tokens: 8192,
            stream: true,
          };
          if (tools && tools.length > 0) args.tools = tools;

          response = await litellm.completion(args);

          let fullContent = '';
          let inputTokens = 0;
          let outputTokens = 0;
          let finishReason: string | undefined;
          const toolCallsMap = new Map<number, any>();

          for await (const chunk of response) {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onChunk(delta.content);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, { id: tc.id, name: tc.function?.name || '', args: tc.function?.arguments || '' });
                } else {
                  const existing = toolCallsMap.get(idx);
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                }
              }
            }
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
            // Track tokens from the final chunk if available
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens || 0;
              outputTokens = chunk.usage.completion_tokens || 0;
            }
          }

          const parsedToolCalls: Array<{ id: string; name: string; args: any }> = [];
          for (const tc of toolCallsMap.values()) {
            let parsedArgs = {};
            try { parsedArgs = JSON.parse(tc.args || '{}'); } catch { /* ignore */ }
            const call = { id: tc.id, name: tc.name, args: parsedArgs };
            parsedToolCalls.push(call);
            if (callbacks.onToolCall) callbacks.onToolCall(call);
          }

          const cost = this.calculateCost(inputTokens, outputTokens);
          const result: LLMResponse = {
            content: fullContent,
            model: this.model,
            provider: this.provider,
            tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
            cost,
            stopReason: finishReason || 'stop',
            toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
          };

          if (callbacks.onComplete) callbacks.onComplete(result);
          return result;
        } else {
          // Non-streaming mode
          const args: any = {
            model: modelString,
            messages,
            temperature: 0.7,
            max_tokens: 8192,
            stream: false,
          };
          if (tools && tools.length > 0) args.tools = tools;

          response = await litellm.completion(args);

          const parsed = this.parseLiteLLMResponse(response);
          if (callbacks?.onComplete) callbacks.onComplete(parsed);
          return parsed;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (callbacks?.onError) callbacks.onError(new Error(errorMsg));
        throw error;
      }
    } catch (error) {
      if (callbacks?.onError) callbacks.onError(error as Error);
      throw error;
    }
  }

  /**
   * Native Gemini REST API call with streaming and multi-turn history support.
   * Converts the OpenAI-style messages array into Gemini's `contents` format.
   */
  private async completeGeminiNative(
    messages: Array<{ role: string; content: string | any[] }>,
    callbacks?: LLMStreamCallback,
    tools?: any[]
  ): Promise<LLMResponse> {
    try {
      // Separate ALL system messages and merge them
      const systemMessages: string[] = [];
      const chatMessages: Array<{ role: string; content: string | any[] }> = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          const text = Array.isArray(msg.content)
            ? msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : msg.content;
          systemMessages.push(text);
        } else {
          chatMessages.push(msg);
        }
      }

      const systemInstruction = systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;

      // Convert to Gemini contents format (user → model alternation)
      const contents = chatMessages.map((m) => {
        let parts: any[] = [];
        if (typeof m.content === 'string') {
          parts = [{ text: m.content }];
        } else if (Array.isArray(m.content)) {
          parts = m.content.map((c: any) => {
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

      const body: any = {
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 65536 },
      };

      if (tools && tools.length > 0) {
        body.tools = [{
          functionDeclarations: tools.map(t => {
            // Translate OpenAI schema to Gemini schema
            const props = t.function.parameters?.properties || {};
            const req = t.function.parameters?.required || [];
            const geminiProps: Record<string, any> = {};
            for (const [k, v] of Object.entries(props)) {
              geminiProps[k] = { ... (v as any), type: ((v as any).type || 'string').toUpperCase() };
            }
            return {
              name: t.function.name,
              description: t.function.description || '',
              parameters: {
                type: 'OBJECT',
                properties: geminiProps,
                required: req
              }
            };
          })
        }];
      }

      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      // Use streaming if onChunk callback is provided
      if (callbacks?.onChunk) {
        return await this.streamGeminiNative(body, callbacks);
      }

      // Non-streaming path
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData: any = await response.json();
        const msg = errData?.error?.message || `HTTP ${response.status}`;
        if (callbacks?.onError) callbacks.onError(new Error(msg));
        throw new Error(`Gemini API error: ${msg}`);
      }

      const data: any = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const content = parts.map((p: any) => p.text || '').join('');
      
      const toolCalls: Array<{ id: string; name: string; args: any }> = [];
      for (const p of parts) {
        if (p.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: p.functionCall.name,
            args: p.functionCall.args || {}
          });
        }
      }

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
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      if (callbacks?.onComplete) callbacks.onComplete(result);
      return result;
    } catch (error) {
      if (callbacks?.onError) callbacks.onError(error as Error);
      throw error;
    }
  }

  /**
   * Stream Gemini response using streamGenerateContent with SSE
   */
  private async streamGeminiNative(
    body: any,
    callbacks: LLMStreamCallback
  ): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData: any = await response.json();
      const msg = errData?.error?.message || `HTTP ${response.status}`;
      if (callbacks.onError) callbacks.onError(new Error(msg));
      throw new Error(`Gemini API error: ${msg}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;
    const toolCallsMap = new Map<string, any>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            
            for (const p of parts) {
              if (p.text) {
                fullContent += p.text;
                if (callbacks.onChunk) callbacks.onChunk(p.text);
              }
              if (p.functionCall) {
                const name = p.functionCall.name;
                if (!toolCallsMap.has(name)) {
                  toolCallsMap.set(name, { id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, name, args: p.functionCall.args || {} });
                } else {
                  // Gemini doesn't stream function calls delta by delta, it usually sends the whole call in one chunk
                  const existing = toolCallsMap.get(name);
                  Object.assign(existing.args, p.functionCall.args || {});
                }
              }
            }
            
            // Track usage from the last chunk
            if (parsed.usageMetadata) {
              inputTokens = parsed.usageMetadata.promptTokenCount || 0;
              outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
            }
            if (parsed.candidates?.[0]?.finishReason) {
              finishReason = parsed.candidates[0].finishReason;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const parsedToolCalls: Array<{ id: string; name: string; args: any }> = [];
    for (const tc of toolCallsMap.values()) {
      parsedToolCalls.push(tc);
      if (callbacks.onToolCall) callbacks.onToolCall(tc);
    }

    const cost = this.calculateCost(inputTokens, outputTokens);

    const result: LLMResponse = {
      content: fullContent,
      model: this.model,
      provider: 'gemini',
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost,
      stopReason: finishReason,
      toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
    };

    if (callbacks.onComplete) callbacks.onComplete(result);
    return result;
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
    
    let toolCalls;
    const rawToolCalls = data.choices?.[0]?.message?.tool_calls;
    if (rawToolCalls && Array.isArray(rawToolCalls)) {
      toolCalls = rawToolCalls.map((tc: any) => {
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ignore */ }
        return {
          id: tc.id,
          name: tc.function?.name || '',
          args
        };
      });
    }

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
      toolCalls
    };
  }

  /**
   * Calculate cost based on tokens and pricing (pricing is per 1M tokens)
   */
  private calculateCost(inputTokens: number, outputTokens: number): { input: number; output: number; total: number } {
    const pricing = LLMServiceLiteLLM.PRICING[this.provider]?.[this.model] || {
      input: 1,
      output: 2,
    };

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

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
    const models = LLMServiceLiteLLM.PRICING[this.provider];
    return models ? Object.keys(models) : [];
  }

  /**
   * Get pricing for a model
   */
  getPricing(model?: string): { input: number; output: number } {
    const m = model || this.model;
    return LLMServiceLiteLLM.PRICING[this.provider]?.[m] || {
      input: 1,
      output: 2,
    };
  }
}
