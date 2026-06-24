/**
 * AI Provider Abstraction Layer
 * Supports multiple AI providers: Anthropic, OpenAI, Local (Ollama), Ribix Backend
 */

export type AIProvider = 'anthropic' | 'openai' | 'ollama' | 'ribix' | 'custom';

export type AIModel = 
  // Anthropic
  | 'claude-3-opus-20240229' 
  | 'claude-3-sonnet-20240229' 
  | 'claude-3-haiku-20240307'
  // OpenAI
  | 'gpt-4-turbo-2024-04-09'
  | 'gpt-4-0125-preview'
  | 'gpt-3.5-turbo-0125'
  // Ollama (local)
  | 'llama3:8b'
  | 'llama3:70b'
  | 'mistral:7b'
  | 'codellama:13b'
  // Custom
  | string;

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey?: string;
  baseURL?: string;
  model: AIModel;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeout?: number;
}

// #87: Redact API keys from error messages and logs.
const REDACTED = '[REDACTED]';
export function redactApiKey(key: string | undefined): string {
  if (!key) return REDACTED;
  if (key.length <= 8) return REDACTED;
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// #99: Default 60s timeout for all AI provider fetch calls.
const DEFAULT_AI_TIMEOUT_MS = 60_000;

function getTimeoutMs(config: AIProviderConfig): number {
  return config.timeout && config.timeout > 0 ? config.timeout : DEFAULT_AI_TIMEOUT_MS;
}

// #87: Validate API key is present at construction time.
function requireApiKey(config: AIProviderConfig, provider: string): string {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new Error(`${provider} API key is required but not configured.`);
  }
  return config.apiKey;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: AIProvider;
  tokensUsed?: number;
  cost?: number;
  latency: number;
}

export interface AIProviderInterface {
  name: AIProvider;
  validateConfig(config: AIProviderConfig): boolean;
  complete(prompt: string, config: AIProviderConfig): Promise<AIResponse>;
  chat(messages: Array<{role: string; content: string}>, config: AIProviderConfig): Promise<AIResponse>;
  estimateCost(prompt: string, config: AIProviderConfig): number;
  getAvailableModels(): AIModel[];
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Anthropic Provider
 */
export class AnthropicProvider implements AIProviderInterface {
  name: AIProvider = 'anthropic';

  validateConfig(config: AIProviderConfig): boolean {
    return !!config.apiKey;
  }

  async complete(prompt: string, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();
    const apiKey = requireApiKey(config, 'Anthropic');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature || 0.7,
      }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.content[0].text,
      model: config.model,
      provider: this.name,
      tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
      cost: this.estimateCost(prompt, config),
      latency,
    };
  }

  async chat(messages: Array<{role: string; content: string}>, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();
    const apiKey = requireApiKey(config, 'Anthropic');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        messages,
        temperature: config.temperature || 0.7,
      }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.content[0].text,
      model: config.model,
      provider: this.name,
      tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
      cost: this.estimateCost(messages.map(m => m.content).join('\n'), config),
      latency,
    };
  }

  estimateCost(prompt: string, config: AIProviderConfig): number {
    const tokenCount = Math.ceil(prompt.length / 4); // Rough estimate
    const costs: Record<string, number> = {
      'claude-3-opus-20240229': 0.015,
      'claude-3-sonnet-20240229': 0.003,
      'claude-3-haiku-20240307': 0.00025,
    };
    const costPer1k = costs[config.model as string] || 0.003;
    return (tokenCount / 1000) * costPer1k;
  }

  getAvailableModels(): AIModel[] {
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }
}

/**
 * OpenAI Provider
 */
export class OpenAIProvider implements AIProviderInterface {
  name: AIProvider = 'openai';

  validateConfig(config: AIProviderConfig): boolean {
    return !!config.apiKey;
  }

  async complete(prompt: string, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();
    const apiKey = requireApiKey(config, 'OpenAI');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
      }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.choices[0].message.content,
      model: config.model,
      provider: this.name,
      tokensUsed: data.usage?.total_tokens,
      cost: this.estimateCost(prompt, config),
      latency,
    };
  }

  async chat(messages: Array<{role: string; content: string}>, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();
    const apiKey = requireApiKey(config, 'OpenAI');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 4096,
      }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.choices[0].message.content,
      model: config.model,
      provider: this.name,
      tokensUsed: data.usage?.total_tokens,
      cost: this.estimateCost(messages.map(m => m.content).join('\n'), config),
      latency,
    };
  }

  estimateCost(prompt: string, config: AIProviderConfig): number {
    const tokenCount = Math.ceil(prompt.length / 4);
    const costs: Record<string, number> = {
      'gpt-4-turbo-2024-04-09': 0.01,
      'gpt-4-0125-preview': 0.03,
      'gpt-3.5-turbo-0125': 0.0005,
    };
    const costPer1k = costs[config.model as string] || 0.01;
    return (tokenCount / 1000) * costPer1k;
  }

  getAvailableModels(): AIModel[] {
    return [
      'gpt-4-turbo-2024-04-09',
      'gpt-4-0125-preview',
      'gpt-3.5-turbo-0125',
    ];
  }
}

/**
 * Ollama (Local) Provider
 */
export class OllamaProvider implements AIProviderInterface {
  name: AIProvider = 'ollama';

  validateConfig(config: AIProviderConfig): boolean {
    return !!config.baseURL;
  }

  async complete(prompt: string, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();
    
    const response = await fetch(`${config.baseURL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: false,
        options: {
          temperature: config.temperature || 0.7,
          num_predict: config.maxTokens || 4096,
        },
      }),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.response,
      model: config.model,
      provider: this.name,
      tokensUsed: data.eval_count,
      cost: 0, // Local models are free
      latency,
    };
  }

  async chat(messages: Array<{role: string; content: string}>, config: AIProviderConfig): Promise<AIResponse> {
    // Convert chat to prompt format for Ollama
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    return this.complete(prompt, config);
  }

  estimateCost(prompt: string, config: AIProviderConfig): number {
    return 0; // Local models are free
  }

  getAvailableModels(): AIModel[] {
    return [
      'llama3:8b',
      'llama3:70b',
      'mistral:7b',
      'codellama:13b',
    ];
  }
}

/**
 * Ribix Backend Provider (existing)
 */
export class RibixProvider implements AIProviderInterface {
  name: AIProvider = 'ribix';

  validateConfig(config: AIProviderConfig): boolean {
    return true; // Ribix backend handles auth separately
  }

  async complete(prompt: string, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();

    // Call existing Ribix backend API
    const response = await fetch(`${config.baseURL || 'http://localhost:3000'}/api/ai/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${config.apiKey || ''}`,
      },
      body: JSON.stringify({ prompt, model: config.model }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.content,
      model: config.model,
      provider: this.name,
      tokensUsed: data.tokensUsed,
      cost: data.cost,
      latency,
    };
  }

  async chat(messages: Array<{role: string; content: string}>, config: AIProviderConfig): Promise<AIResponse> {
    const startTime = Date.now();

    const response = await fetch(`${config.baseURL || 'http://localhost:3000'}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${config.apiKey || ''}`,
      },
      body: JSON.stringify({ messages, model: config.model }),
      signal: AbortSignal.timeout(getTimeoutMs(config)),
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    return {
      content: data.content,
      model: config.model,
      provider: this.name,
      tokensUsed: data.tokensUsed,
      cost: data.cost,
      latency,
    };
  }

  estimateCost(prompt: string, config: AIProviderConfig): number {
    // Ribix backend handles cost estimation
    return 0;
  }

  getAvailableModels(): AIModel[] {
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'gpt-4-turbo-2024-04-09',
    ];
  }
}

/**
 * AI Provider Manager
 */
export class AIProviderManager {
  private providers: Map<AIProvider, AIProviderInterface> = new Map();
  private currentProvider: AIProvider = 'anthropic';
  private currentConfig: AIProviderConfig;

  constructor() {
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('ollama', new OllamaProvider());
    this.providers.set('ribix', new RibixProvider());

    // Default configuration
    this.currentConfig = {
      provider: this.currentProvider,
      model: 'claude-3-sonnet-20240229',
      temperature: 0.7,
      maxTokens: 4096,
    };
  }

  getProvider(): AIProvider {
    return this.currentProvider;
  }

  setProvider(provider: AIProvider): void {
    const providerImpl = this.providers.get(provider);
    if (!providerImpl) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    this.currentProvider = provider;
    this.currentConfig = {
      ...this.currentConfig,
      provider,
    };
  }

  getConfig(): AIProviderConfig {
    return { ...this.currentConfig };
  }

  async complete(prompt: string): Promise<AIResponse> {
    const provider = this.providers.get(this.currentConfig.provider);
    if (!provider) {
      throw new Error(`Provider not found: ${this.currentConfig.provider}`);
    }

    return provider.complete(prompt, this.currentConfig);
  }

  async chat(messages: Array<{role: string; content: string}>): Promise<AIResponse> {
    const provider = this.providers.get(this.currentConfig.provider);
    if (!provider) {
      throw new Error(`Provider not found: ${this.currentConfig.provider}`);
    }

    return provider.chat(messages, this.currentConfig);
  }

  async callLLM(messages: LLMMessage[], opts?: LLMOptions): Promise<string> {
    const config: AIProviderConfig = {
      ...this.currentConfig,
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts?.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    };

    let response: AIResponse;
    switch (this.currentProvider) {
      case 'anthropic':
        response = await this.callAnthropic(messages, config);
        break;
      case 'openai':
        response = await this.callOpenAI(messages, config);
        break;
      case 'ollama':
        response = await this.callOllama(messages, config);
        break;
      case 'ribix':
        response = await this.callRibixBackend(messages, config);
        break;
      default:
        throw new Error(`Unsupported provider: ${this.currentProvider}`);
    }

    return response.content;
  }

  private async callAnthropic(messages: LLMMessage[], config: AIProviderConfig): Promise<AIResponse> {
    const provider = this.providers.get('anthropic')!;
    return provider.chat(messages, config);
  }

  private async callOpenAI(messages: LLMMessage[], config: AIProviderConfig): Promise<AIResponse> {
    const provider = this.providers.get('openai')!;
    return provider.chat(messages, config);
  }

  private async callOllama(messages: LLMMessage[], config: AIProviderConfig): Promise<AIResponse> {
    const provider = this.providers.get('ollama')!;
    return provider.chat(messages, config);
  }

  private async callRibixBackend(messages: LLMMessage[], config: AIProviderConfig): Promise<AIResponse> {
    const provider = this.providers.get('ribix')!;
    return provider.chat(messages, config);
  }

  estimateCost(tokens: number): { provider: AIProvider; costUsd: number } {
    const costs: Record<string, number> = {
      'claude-3-opus-20240229': 0.015,
      'claude-3-sonnet-20240229': 0.003,
      'claude-3-haiku-20240307': 0.00025,
      'gpt-4-turbo-2024-04-09': 0.01,
      'gpt-4-0125-preview': 0.03,
      'gpt-3.5-turbo-0125': 0.0005,
    };
    const costPer1k = costs[this.currentConfig.model as string] ?? 0;
    return {
      provider: this.currentProvider,
      costUsd: (tokens / 1000) * costPer1k,
    };
  }

  getAvailableProviders(): AIProvider[] {
    return Array.from(this.providers.keys());
  }

  getAvailableModels(provider?: AIProvider): AIModel[] {
    if (provider) {
      const providerImpl = this.providers.get(provider);
      return providerImpl?.getAvailableModels() || [];
    }
    return Array.from(this.providers.values()).flatMap(p => p.getAvailableModels());
  }

  compareProviders(prompt: string): Array<{
    provider: AIProvider;
    estimatedCost: number;
    availableModels: AIModel[];
  }> {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      provider: name,
      estimatedCost: provider.estimateCost(prompt, this.currentConfig),
      availableModels: provider.getAvailableModels(),
    }));
  }
}

// Singleton instance
export const aiProviderManager = new AIProviderManager();