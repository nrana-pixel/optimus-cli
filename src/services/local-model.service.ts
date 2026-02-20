/**
 * Local Model Service
 * Handles interactions with local models running on localhost, ngrok, cloudflare, or other tunneling services
 * Supports Ollama, OpenAI-compatible, and generic HTTP endpoints
 * NOW WITH STREAMING — tokens appear as they are generated
 */

import type { LocalModel, LocalModelTestResult, LocalModelResponse } from '../types/local-model.js';

export interface LLMStreamCallback {
  onChunk?: (chunk: string) => void;
  onComplete?: (response: LocalModelResponse) => void;
  onError?: (error: Error) => void;
}

export class LocalModelService {
  private model: LocalModel;
  private testTimeout: number = 15000;        // 15s for probes/tests
  private completionTimeout: number = 300000;  // 5 min for actual completions

  constructor(model: LocalModel) {
    this.model = model;
  }

  // ─── Test helpers ─────────────────────────────────────────────────────────

  async testEndpoint(): Promise<LocalModelTestResult> {
    try {
      const startTime = Date.now();
      if (this.model.type === 'ollama') return this.testOllamaEndpoint(startTime);
      if (this.model.type === 'openai-compatible') return this.testOpenAIEndpoint(startTime);
      return this.testGenericEndpoint(startTime);
    } catch (error) {
      return { success: false, message: `Endpoint test failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async testOllamaEndpoint(t0: number): Promise<LocalModelTestResult> {
    try {
      const r = await fetch(`${this.model.endpoint}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(this.testTimeout) });
      if (!r.ok) return { success: false, message: `Ollama returned ${r.status}` };
      const data = await r.json() as any;
      const models: any[] = data.models || [];
      return {
        success: true, latency: Date.now() - t0,
        message: `Ollama OK — models: ${models.map((m: any) => m.name).join(', ') || 'none'}`,
        modelInfo: { name: 'Ollama', capabilities: ['chat', 'completion', 'streaming'] },
      };
    } catch (e) {
      return { success: false, message: `Ollama unreachable: ${e instanceof Error ? e.message : e}` };
    }
  }

  private async testOpenAIEndpoint(t0: number): Promise<LocalModelTestResult> {
    try {
      const r = await fetch(`${this.model.endpoint}/v1/models`, { method: 'GET', signal: AbortSignal.timeout(this.testTimeout) });
      if (!r.ok) return { success: false, message: `OpenAI-compatible returned ${r.status}` };
      return {
        success: true, latency: Date.now() - t0,
        message: `OpenAI-compatible endpoint OK`,
        modelInfo: { name: this.model.model || 'default', capabilities: ['chat', 'completion', 'streaming'] },
      };
    } catch (e) {
      return { success: false, message: `OpenAI-compatible unreachable: ${e instanceof Error ? e.message : e}` };
    }
  }

  private async testGenericEndpoint(t0: number): Promise<LocalModelTestResult> {
    try {
      const r = await fetch(this.model.endpoint, { method: 'GET', signal: AbortSignal.timeout(this.testTimeout) });
      return r.ok
        ? { success: true, latency: Date.now() - t0, message: 'Endpoint accessible' }
        : { success: false, message: `Endpoint returned ${r.status}` };
    } catch (e) {
      return { success: false, message: `Unreachable: ${e instanceof Error ? e.message : e}` };
    }
  }

  // ─── Completion (public API) ──────────────────────────────────────────────

  async complete(message: string, systemPrompt?: string, callbacks?: LLMStreamCallback): Promise<LocalModelResponse> {
    const msgs: Array<{ role: string; content: string }> = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    msgs.push({ role: 'user', content: message });
    return this.completeWithHistory(msgs, callbacks);
  }

  async completeWithHistory(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback,
  ): Promise<LocalModelResponse> {
    try {
      if (this.model.type === 'ollama') return await this.streamOllama(messages, callbacks);
      return await this.streamOpenAI(messages, callbacks);
    } catch (error) {
      callbacks?.onError?.(error as Error);
      throw error;
    }
  }

  // ─── Ollama streaming ───────────────────────────────────────────────────

  private async streamOllama(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback,
  ): Promise<LocalModelResponse> {
    const modelName = this.model.model || 'llama2';

    const response = await fetch(`${this.model.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages, stream: true, temperature: 0.7 }),
      signal: AbortSignal.timeout(this.completionTimeout),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any;
      throw new Error(`Ollama API error: ${err.error || response.statusText}`);
    }

    // Ollama streams NDJSON lines — each is a JSON object with message.content
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body from Ollama');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as any;
            const token = chunk.message?.content || '';
            if (token) {
              fullContent += token;
              callbacks?.onChunk?.(token);
            }
            // Final message has done: true with eval counts
            if (chunk.done) {
              inputTokens = chunk.prompt_eval_count || 0;
              outputTokens = chunk.eval_count || 0;
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const result: LocalModelResponse = {
      content: fullContent,
      model: modelName,
      tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    };
    callbacks?.onComplete?.(result);
    return result;
  }

  // ─── OpenAI-compatible streaming ──────────────────────────────────────────

  private async streamOpenAI(
    messages: Array<{ role: string; content: string }>,
    callbacks?: LLMStreamCallback,
  ): Promise<LocalModelResponse> {
    const modelName = this.model.model || 'default';

    const response = await fetch(`${this.model.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.model.apiKey && { Authorization: `Bearer ${this.model.apiKey}` }),
      },
      body: JSON.stringify({
        model: modelName, messages,
        temperature: 0.7, max_tokens: 4096,
        stream: true,
      }),
      signal: AbortSignal.timeout(this.completionTimeout),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any;
      throw new Error(`OpenAI API error: ${err.error?.message || response.statusText}`);
    }

    let fullContent = '';
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') break;
          try {
            const chunk = JSON.parse(data) as any;
            const token = chunk.choices?.[0]?.delta?.content || '';
            if (token) {
              fullContent += token;
              callbacks?.onChunk?.(token);
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const result: LocalModelResponse = {
      content: fullContent,
      model: modelName,
      tokensUsed: { input: 0, output: 0, total: 0 },  // SSE doesn't always include usage
    };
    callbacks?.onComplete?.(result);
    return result;
  }

  // ─── Accessors ──────────────────────────────────────────────────────────

  getModel(): LocalModel { return this.model; }
  getModelName(): string { return this.model.model || this.model.name; }
}
