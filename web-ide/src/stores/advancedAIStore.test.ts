import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAdvancedAIStore, AdvancedAIService } from './advancedAIStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  useAdvancedAIStore.setState({
    isProcessing: false,
    currentTask: null,
    results: null,
    error: null,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdvancedAIService', () => {
  it('generateCode posts to /generate and returns the parsed body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockFetchResponse({
          generatedCode: 'const x = 1;',
          explanation: 'exp',
          confidence: 0.9,
          suggestions: ['s1'],
        }),
      );

    const service = new AdvancedAIService('/api/ai', 'key-1');
    const result = await service.generateCode({
      prompt: 'make a function',
      context: { language: 'ts' },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/ai/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer key-1',
        }),
      }),
    );
    expect(result.generatedCode).toBe('const x = 1;');
    expect(result.confidence).toBe(0.9);
  });

  it('generateCode throws "Code generation failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));
    const service = new AdvancedAIService();
    await expect(
      service.generateCode({ prompt: 'x', context: {} }),
    ).rejects.toThrow('Code generation failed');
  });

  it('refactorCode posts to /refactor and returns the parsed body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockFetchResponse({
          refactoredCode: 'r',
          changes: [],
          explanation: 'e',
        }),
      );

    const service = new AdvancedAIService();
    const result = await service.refactorCode({
      code: 'c',
      language: 'ts',
      refactoringType: 'optimize',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/refactor'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.refactoredCode).toBe('r');
  });

  it('refactorCode throws "Refactoring failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(
      service.refactorCode({ code: 'c', language: 'ts', refactoringType: 'simplify' }),
    ).rejects.toThrow('Refactoring failed');
  });

  it('debugCode posts to /debug and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        diagnosis: 'd',
        rootCause: 'rc',
        suggestedFix: 'sf',
        fixedCode: 'fc',
        confidence: 0.8,
      }),
    );

    const service = new AdvancedAIService();
    const result = await service.debugCode({ code: 'c', language: 'ts', error: 'err' });
    expect(result.fixedCode).toBe('fc');
    expect(result.confidence).toBe(0.8);
  });

  it('debugCode throws "Debugging failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(
      service.debugCode({ code: 'c', language: 'ts' }),
    ).rejects.toThrow('Debugging failed');
  });

  it('reviewCode posts to /review and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        issues: [],
        overallScore: 95,
        summary: 'good',
      }),
    );

    const service = new AdvancedAIService();
    const result = await service.reviewCode({ code: 'c', language: 'ts', reviewType: 'security' });
    expect(result.overallScore).toBe(95);
  });

  it('reviewCode throws "Code review failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(
      service.reviewCode({ code: 'c', language: 'ts', reviewType: 'comprehensive' }),
    ).rejects.toThrow('Code review failed');
  });

  it('generateDocumentation posts to /document and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ documentation: 'doc', examples: ['e1'] }),
    );

    const service = new AdvancedAIService();
    const result = await service.generateDocumentation('c', 'ts');
    expect(result.documentation).toBe('doc');
    expect(result.examples).toEqual(['e1']);
  });

  it('generateDocumentation throws "Documentation generation failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(service.generateDocumentation('c', 'ts')).rejects.toThrow(
      'Documentation generation failed',
    );
  });

  it('explainCode posts to /explain and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ explanation: 'exp', complexity: 3, concepts: ['c1'] }),
    );

    const service = new AdvancedAIService();
    const result = await service.explainCode('c', 'ts');
    expect(result.explanation).toBe('exp');
    expect(result.complexity).toBe(3);
  });

  it('explainCode throws "Code explanation failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(service.explainCode('c', 'ts')).rejects.toThrow('Code explanation failed');
  });

  it('generateTests posts to /generate-tests and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ tests: 't', coverage: 0.9 }),
    );

    const service = new AdvancedAIService();
    const result = await service.generateTests('c', 'ts', 'vitest');
    expect(result.tests).toBe('t');
    expect(result.coverage).toBe(0.9);
  });

  it('generateTests throws "Test generation failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(service.generateTests('c', 'ts')).rejects.toThrow('Test generation failed');
  });

  it('optimizeCode posts to /optimize and returns the parsed body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ optimizedCode: 'o', improvements: ['i'], performanceGain: '10x' }),
    );

    const service = new AdvancedAIService();
    const result = await service.optimizeCode('c', 'ts');
    expect(result.optimizedCode).toBe('o');
    expect(result.performanceGain).toBe('10x');
  });

  it('optimizeCode throws "Code optimization failed" on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));
    const service = new AdvancedAIService();
    await expect(service.optimizeCode('c', 'ts')).rejects.toThrow('Code optimization failed');
  });

  it('uses an empty api key by default', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ generatedCode: '', explanation: '', confidence: 0, suggestions: [] }));
    const service = new AdvancedAIService();
    await service.generateCode({ prompt: 'x', context: {} });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ' }),
      }),
    );
  });

  it('propagates network errors from fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const service = new AdvancedAIService();
    await expect(
      service.generateCode({ prompt: 'x', context: {} }),
    ).rejects.toThrow('network down');
  });
});

describe('useAdvancedAIStore', () => {
  it('starts with default state', () => {
    const s = useAdvancedAIStore.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.currentTask).toBeNull();
    expect(s.results).toBeNull();
    expect(s.error).toBeNull();
  });

  it('setError sets the error state', () => {
    useAdvancedAIStore.getState().setError('boom');
    expect(useAdvancedAIStore.getState().error).toBe('boom');
    useAdvancedAIStore.getState().setError(null);
    expect(useAdvancedAIStore.getState().error).toBeNull();
  });

  it('generateCode stores results and clears processing on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        generatedCode: 'code',
        explanation: 'e',
        confidence: 1,
        suggestions: [],
      }),
    );

    await useAdvancedAIStore.getState().generateCode({ prompt: 'p', context: {} });

    const s = useAdvancedAIStore.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.currentTask).toBeNull();
    expect(s.error).toBeNull();
    expect(s.results.generatedCode).toBe('code');
  });

  it('generateCode sets currentTask while processing', async () => {
    let observedTask: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ generatedCode: '', explanation: '', confidence: 0, suggestions: [] }),
    );
    const promise = useAdvancedAIStore.getState().generateCode({ prompt: 'p', context: {} });
    observedTask = useAdvancedAIStore.getState().currentTask;
    await promise;
    expect(observedTask).toBe('Generating code...');
  });

  it('generateCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    await useAdvancedAIStore.getState().generateCode({ prompt: 'p', context: {} });

    const s = useAdvancedAIStore.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.currentTask).toBeNull();
    expect(s.error).toBe('Code generation failed');
  });

  it('refactorCode stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ refactoredCode: 'r', changes: [], explanation: 'e' }),
    );

    await useAdvancedAIStore.getState().refactorCode({
      code: 'c',
      language: 'ts',
      refactoringType: 'simplify',
    });

    expect(useAdvancedAIStore.getState().results.refactoredCode).toBe('r');
    expect(useAdvancedAIStore.getState().currentTask).toBeNull();
  });

  it('refactorCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().refactorCode({
      code: 'c',
      language: 'ts',
      refactoringType: 'simplify',
    });

    expect(useAdvancedAIStore.getState().error).toBe('Refactoring failed');
    expect(useAdvancedAIStore.getState().currentTask).toBeNull();
  });

  it('debugCode stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ diagnosis: 'd', rootCause: 'rc', suggestedFix: 'sf', fixedCode: 'fc', confidence: 0.5 }),
    );

    await useAdvancedAIStore.getState().debugCode({ code: 'c', language: 'ts' });

    expect(useAdvancedAIStore.getState().results.fixedCode).toBe('fc');
  });

  it('debugCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().debugCode({ code: 'c', language: 'ts' });

    expect(useAdvancedAIStore.getState().error).toBe('Debugging failed');
  });

  it('reviewCode stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ issues: [], overallScore: 80, summary: 'ok' }),
    );

    await useAdvancedAIStore.getState().reviewCode({ code: 'c', language: 'ts', reviewType: 'style' });

    expect(useAdvancedAIStore.getState().results.overallScore).toBe(80);
  });

  it('reviewCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().reviewCode({ code: 'c', language: 'ts', reviewType: 'style' });

    expect(useAdvancedAIStore.getState().error).toBe('Code review failed');
  });

  it('generateDocumentation stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ documentation: 'doc', examples: ['e'] }),
    );

    await useAdvancedAIStore.getState().generateDocumentation('c', 'ts');

    expect(useAdvancedAIStore.getState().results.documentation).toBe('doc');
  });

  it('generateDocumentation sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().generateDocumentation('c', 'ts');

    expect(useAdvancedAIStore.getState().error).toBe('Documentation generation failed');
  });

  it('explainCode stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ explanation: 'exp', complexity: 2, concepts: ['c'] }),
    );

    await useAdvancedAIStore.getState().explainCode('c', 'ts');

    expect(useAdvancedAIStore.getState().results.explanation).toBe('exp');
  });

  it('explainCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().explainCode('c', 'ts');

    expect(useAdvancedAIStore.getState().error).toBe('Code explanation failed');
  });

  it('generateTests stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ tests: 't', coverage: 0.9 }),
    );

    await useAdvancedAIStore.getState().generateTests('c', 'ts', 'vitest');

    expect(useAdvancedAIStore.getState().results.tests).toBe('t');
  });

  it('generateTests sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().generateTests('c', 'ts');

    expect(useAdvancedAIStore.getState().error).toBe('Test generation failed');
  });

  it('optimizeCode stores results on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ optimizedCode: 'o', improvements: [], performanceGain: '2x' }),
    );

    await useAdvancedAIStore.getState().optimizeCode('c', 'ts');

    expect(useAdvancedAIStore.getState().results.optimizedCode).toBe('o');
  });

  it('optimizeCode sets error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false));

    await useAdvancedAIStore.getState().optimizeCode('c', 'ts');

    expect(useAdvancedAIStore.getState().error).toBe('Code optimization failed');
  });
});
