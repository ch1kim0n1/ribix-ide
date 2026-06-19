import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAIChatStore } from './aiChatStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  useAIChatStore.setState({
    messages: [],
    isLoading: false,
    currentProvider: {
      provider: 'ribix',
      model: 'claude-3-sonnet-20240229',
      temperature: 0.7,
      maxTokens: 4096,
    },
    providers: {
      ribix: {
        provider: 'ribix',
        model: 'claude-3-sonnet-20240229',
        temperature: 0.7,
        maxTokens: 4096,
      },
      anthropic: {
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        temperature: 0.7,
        maxTokens: 4096,
      },
      openai: {
        provider: 'openai',
        model: 'gpt-4-turbo-2024-04-09',
        temperature: 0.7,
        maxTokens: 4096,
      },
    },
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAIChatStore', () => {
  it('starts with empty messages and default ribix provider', () => {
    const s = useAIChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.currentProvider.provider).toBe('ribix');
    expect(s.currentProvider.model).toBe('claude-3-sonnet-20240229');
    expect(s.providers.ribix).toBeDefined();
    expect(s.providers.anthropic).toBeDefined();
    expect(s.providers.openai).toBeDefined();
  });

  it('addMessage appends a message to the list', () => {
    useAIChatStore.getState().addMessage({
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    });
    const msgs = useAIChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
    expect(msgs[0].role).toBe('user');
  });

  it('clearMessages empties the message list', () => {
    useAIChatStore.getState().addMessage({
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    });
    useAIChatStore.getState().clearMessages();
    expect(useAIChatStore.getState().messages).toEqual([]);
  });

  it('setLoading toggles isLoading', () => {
    useAIChatStore.getState().setLoading(true);
    expect(useAIChatStore.getState().isLoading).toBe(true);
    useAIChatStore.getState().setLoading(false);
    expect(useAIChatStore.getState().isLoading).toBe(false);
  });

  it('setProvider updates currentProvider and stores it in providers map', () => {
    const newProvider = {
      provider: 'openai' as const,
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 2048,
      apiKey: 'key-123',
    };
    useAIChatStore.getState().setProvider(newProvider);
    const s = useAIChatStore.getState();
    expect(s.currentProvider).toEqual(newProvider);
    expect(s.providers.openai).toEqual(newProvider);
  });

  it('setProvider preserves other providers', () => {
    useAIChatStore.getState().setProvider({
      provider: 'ollama',
      model: 'llama3',
      temperature: 0.2,
      maxTokens: 1024,
    });
    const s = useAIChatStore.getState();
    expect(s.providers.ribix).toBeDefined();
    expect(s.providers.anthropic).toBeDefined();
    expect(s.providers.ollama).toBeDefined();
  });

  it('sendMessage adds user message, calls API, adds assistant message and returns content', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ content: 'AI reply' }));

    const result = await useAIChatStore.getState().sendMessage('hi there');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/ai/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.provider).toBe('ribix');
    expect(body.model).toBe('claude-3-sonnet-20240229');
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi there' },
    ]);

    const msgs = useAIChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hi there');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('AI reply');
    expect(useAIChatStore.getState().isLoading).toBe(false);
    expect(result).toBe('AI reply');
  });

  it('sendMessage includes prior messages in the request body', async () => {
    useAIChatStore.getState().addMessage({
      role: 'user',
      content: 'first',
      timestamp: 1,
    });
    useAIChatStore.getState().addMessage({
      role: 'assistant',
      content: 'reply1',
      timestamp: 2,
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ content: 'reply2' }));

    await useAIChatStore.getState().sendMessage('second');

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    // two prior messages + new user message
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({ role: 'user', content: 'second' });
  });

  it('sendMessage uses currentProvider settings in the request', async () => {
    useAIChatStore.getState().setProvider({
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.1,
      maxTokens: 512,
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ content: 'ok' }));

    await useAIChatStore.getState().sendMessage('test');

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.1);
    expect(body.maxTokens).toBe(512);
  });

  it('sendMessage throws and resets loading on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: 'rate limited' }, false, 429),
    );

    await expect(
      useAIChatStore.getState().sendMessage('hi'),
    ).rejects.toThrow('AI request failed');

    const s = useAIChatStore.getState();
    expect(s.isLoading).toBe(false);
    // user message was added before the request
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe('user');
  });

  it('sendMessage throws and resets loading on network rejection', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      useAIChatStore.getState().sendMessage('hi'),
    ).rejects.toThrow('network down');

    expect(useAIChatStore.getState().isLoading).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});
