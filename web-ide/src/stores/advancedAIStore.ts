/**
 * Advanced AI Features for Code Intelligence
 * Includes code generation, refactoring, debugging, and code review
 */

import { apiUrl } from '../lib/api';

export interface AICodeGenerationRequest {
  prompt: string;
  context: {
    file?: string;
    selection?: string;
    language?: string;
    surroundingCode?: string;
  };
  options?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
  };
}

export interface AICodeGenerationResponse {
  generatedCode: string;
  explanation: string;
  confidence: number;
  suggestions: string[];
}

export interface AIRefactoringRequest {
  code: string;
  language: string;
  refactoringType: 'extract-function' | 'rename-variable' | 'optimize' | 'simplify' | 'add-types';
  options?: {
    preserveBehavior?: boolean;
    addComments?: boolean;
  };
}

export interface AIRefactoringResponse {
  refactoredCode: string;
  changes: Array<{
    type: string;
    description: string;
    lineStart: number;
    lineEnd: number;
  }>;
  explanation: string;
}

export interface AIDebuggingRequest {
  code: string;
  error?: string;
  language: string;
  context?: string;
}

export interface AIDebuggingResponse {
  diagnosis: string;
  rootCause: string;
  suggestedFix: string;
  fixedCode: string;
  confidence: number;
}

export interface AICodeReviewRequest {
  code: string;
  language: string;
  reviewType: 'security' | 'performance' | 'style' | 'best-practices' | 'comprehensive';
}

export interface AICodeReviewResponse {
  issues: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    description: string;
    line?: number;
    suggestion?: string;
  }>;
  overallScore: number;
  summary: string;
}

export class AdvancedAIService {
  private apiBase: string;
  private apiKey: string;

  constructor(apiBase: string = apiUrl('/ai'), apiKey?: string) {
    this.apiBase = apiBase;
    this.apiKey = apiKey || '';
  }

  /**
   * Generate code from natural language prompt
   */
  async generateCode(request: AICodeGenerationRequest): Promise<AICodeGenerationResponse> {
    const response = await fetch(`${this.apiBase}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Code generation failed');
    }

    return response.json();
  }

  /**
   * Refactor code with AI assistance
   */
  async refactorCode(request: AIRefactoringRequest): Promise<AIRefactoringResponse> {
    const response = await fetch(`${this.apiBase}/refactor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Refactoring failed');
    }

    return response.json();
  }

  /**
   * Debug code with AI assistance
   */
  async debugCode(request: AIDebuggingRequest): Promise<AIDebuggingResponse> {
    const response = await fetch(`${this.apiBase}/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Debugging failed');
    }

    return response.json();
  }

  /**
   * Review code with AI
   */
  async reviewCode(request: AICodeReviewRequest): Promise<AICodeReviewResponse> {
    const response = await fetch(`${this.apiBase}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error('Code review failed');
    }

    return response.json();
  }

  /**
   * Generate documentation from code
   */
  async generateDocumentation(code: string, language: string): Promise<{
    documentation: string;
    examples: string[];
  }> {
    const response = await fetch(`${this.apiBase}/document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error('Documentation generation failed');
    }

    return response.json();
  }

  /**
   * Explain code
   */
  async explainCode(code: string, language: string): Promise<{
    explanation: string;
    complexity: number;
    concepts: string[];
  }> {
    const response = await fetch(`${this.apiBase}/explain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error('Code explanation failed');
    }

    return response.json();
  }

  /**
   * Generate tests for code
   */
  async generateTests(code: string, language: string, framework?: string): Promise<{
    tests: string;
    coverage: number;
  }> {
    const response = await fetch(`${this.apiBase}/generate-tests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ code, language, framework }),
    });

    if (!response.ok) {
      throw new Error('Test generation failed');
    }

    return response.json();
  }

  /**
   * Optimize code for performance
   */
  async optimizeCode(code: string, language: string): Promise<{
    optimizedCode: string;
    improvements: string[];
    performanceGain: string;
  }> {
    const response = await fetch(`${this.apiBase}/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ code, language }),
    });

    if (!response.ok) {
      throw new Error('Code optimization failed');
    }

    return response.json();
  }
}

/**
 * Advanced AI Store for React
 */
import { create } from 'zustand';

interface AdvancedAIState {
  isProcessing: boolean;
  currentTask: string | null;
  results: any;
  error: string | null;
  
  // Actions
  generateCode: (request: AICodeGenerationRequest) => Promise<void>;
  refactorCode: (request: AIRefactoringRequest) => Promise<void>;
  debugCode: (request: AIDebuggingRequest) => Promise<void>;
  reviewCode: (request: AICodeReviewRequest) => Promise<void>;
  generateDocumentation: (code: string, language: string) => Promise<void>;
  explainCode: (code: string, language: string) => Promise<void>;
  generateTests: (code: string, language: string, framework?: string) => Promise<void>;
  optimizeCode: (code: string, language: string) => Promise<void>;
  setError: (error: string | null) => void;
}

const aiService = new AdvancedAIService();

export const useAdvancedAIStore = create<AdvancedAIState>((set) => ({
  isProcessing: false,
  currentTask: null,
  results: null,
  error: null,

  setError: (error) => set({ error }),

  generateCode: async (request) => {
    set({ isProcessing: true, currentTask: 'Generating code...', error: null });
    try {
      const results = await aiService.generateCode(request);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Code generation failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  refactorCode: async (request) => {
    set({ isProcessing: true, currentTask: 'Refactoring code...', error: null });
    try {
      const results = await aiService.refactorCode(request);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Refactoring failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  debugCode: async (request) => {
    set({ isProcessing: true, currentTask: 'Analyzing code...', error: null });
    try {
      const results = await aiService.debugCode(request);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Debugging failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  reviewCode: async (request) => {
    set({ isProcessing: true, currentTask: 'Reviewing code...', error: null });
    try {
      const results = await aiService.reviewCode(request);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Code review failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  generateDocumentation: async (code, language) => {
    set({ isProcessing: true, currentTask: 'Generating documentation...', error: null });
    try {
      const results = await aiService.generateDocumentation(code, language);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Documentation generation failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  explainCode: async (code, language) => {
    set({ isProcessing: true, currentTask: 'Explaining code...', error: null });
    try {
      const results = await aiService.explainCode(code, language);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Code explanation failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  generateTests: async (code, language, framework) => {
    set({ isProcessing: true, currentTask: 'Generating tests...', error: null });
    try {
      const results = await aiService.generateTests(code, language, framework);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Test generation failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },

  optimizeCode: async (code, language) => {
    set({ isProcessing: true, currentTask: 'Optimizing code...', error: null });
    try {
      const results = await aiService.optimizeCode(code, language);
      set({ results, isProcessing: false, currentTask: null });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Code optimization failed',
        isProcessing: false,
        currentTask: null,
      });
    }
  },
}));
