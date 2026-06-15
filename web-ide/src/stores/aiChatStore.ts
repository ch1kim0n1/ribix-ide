import { create } from 'zustand';

interface AIProvider {
  provider: 'anthropic' | 'openai' | 'ollama' | 'ribix';
  apiKey?: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface AIChatState {
  messages: AIMessage[];
  isLoading: boolean;
  currentProvider: AIProvider;
  providers: Record<string, AIProvider>;
  addMessage: (message: AIMessage) => void;
  clearMessages: () => void;
  setProvider: (provider: AIProvider) => void;
  sendMessage: (prompt: string) => Promise<string>;
  setLoading: (loading: boolean) => void;
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
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

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  clearMessages: () =>
    set({
      messages: [],
    }),

  setProvider: (provider) =>
    set({
      currentProvider: provider,
      providers: {
        ...get().providers,
        [provider.provider]: provider,
      },
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  sendMessage: async (prompt: string) => {
    const { currentProvider, addMessage, setLoading, messages } = get();
    
    setLoading(true);
    
    // Add user message
    addMessage({
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });

    try {
      const response = await fetch('http://localhost:3000/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: currentProvider.provider,
          model: currentProvider.model,
          messages: [...messages, { role: 'user', content: prompt }],
          temperature: currentProvider.temperature,
          maxTokens: currentProvider.maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error('AI request failed');
      }

      const data = await response.json();
      
      // Add assistant response
      addMessage({
        role: 'assistant',
        content: data.content,
        timestamp: Date.now(),
      });

      setLoading(false);
      return data.content;
    } catch (error) {
      console.error('AI chat error:', error);
      setLoading(false);
      throw error;
    }
  },
}));