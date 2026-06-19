import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTerminalStore } from './terminalStore';

function mockFetchResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  useTerminalStore.setState({
    lines: [],
    currentDirectory: '/workspace',
    commandHistory: [],
    historyIndex: -1,
    isRunning: false,
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTerminalStore', () => {
  it('starts with empty lines and /workspace cwd', () => {
    const s = useTerminalStore.getState();
    expect(s.lines).toEqual([]);
    expect(s.currentDirectory).toBe('/workspace');
    expect(s.isRunning).toBe(false);
  });

  it('setCurrentDirectory updates cwd', () => {
    useTerminalStore.getState().setCurrentDirectory('/home');
    expect(useTerminalStore.getState().currentDirectory).toBe('/home');
  });

  it('setRunning toggles isRunning', () => {
    useTerminalStore.getState().setRunning(true);
    expect(useTerminalStore.getState().isRunning).toBe(true);
    useTerminalStore.getState().setRunning(false);
    expect(useTerminalStore.getState().isRunning).toBe(false);
  });

  it('addLine appends a line with id and timestamp', () => {
    useTerminalStore.getState().addLine({ type: 'output', content: 'hello' });
    const lines = useTerminalStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].content).toBe('hello');
    expect(lines[0].type).toBe('output');
    expect(lines[0].id).toBeTruthy();
  });

  it('clearHistory empties lines', () => {
    useTerminalStore.getState().addLine({ type: 'output', content: 'a' });
    useTerminalStore.getState().clearHistory();
    expect(useTerminalStore.getState().lines).toEqual([]);
  });

  it('executeCommand adds input line, calls API, adds output', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockFetchResponse({ output: 'result', exitCode: 0, cwd: '/workspace' }));

    await useTerminalStore.getState().executeCommand('ls');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/web-ide/terminal/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ command: 'ls', cwd: '/workspace' }),
      }),
    );

    const lines = useTerminalStore.getState().lines;
    // input line + output line
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe('input');
    expect(lines[0].content).toContain('ls');
    expect(lines[1].type).toBe('output');
    expect(lines[1].content).toBe('result');
    expect(useTerminalStore.getState().isRunning).toBe(false);
  });

  it('executeCommand records command in history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ output: '', exitCode: 0 }),
    );

    await useTerminalStore.getState().executeCommand('echo hi');

    expect(useTerminalStore.getState().commandHistory).toContain('echo hi');
  });

  it('executeCommand does not record empty/whitespace commands in history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ output: '', exitCode: 0 }),
    );

    await useTerminalStore.getState().executeCommand('   ');

    expect(useTerminalStore.getState().commandHistory).toEqual([]);
  });

  it('executeCommand updates cwd when response differs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ output: '', exitCode: 0, cwd: '/home/user' }),
    );

    await useTerminalStore.getState().executeCommand('cd /home/user');

    expect(useTerminalStore.getState().currentDirectory).toBe('/home/user');
  });

  it('executeCommand adds error line on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, false),
    );

    await useTerminalStore.getState().executeCommand('bad');

    const errorLines = useTerminalStore.getState().lines.filter(l => l.type === 'error');
    expect(errorLines).toHaveLength(1);
    expect(useTerminalStore.getState().isRunning).toBe(false);
  });

  it('executeCommand adds error line on network rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await useTerminalStore.getState().executeCommand('ls');

    const errorLines = useTerminalStore.getState().lines.filter(l => l.type === 'error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0].content).toBe('network down');
  });

  it('executeCommand adds error content when data.error is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ output: 'partial', error: 'warning', exitCode: 1 }),
    );

    await useTerminalStore.getState().executeCommand('make');

    const lines = useTerminalStore.getState().lines;
    const outputLine = lines.find(l => l.type === 'output');
    const errorLine = lines.find(l => l.type === 'error');
    expect(outputLine?.content).toBe('partial');
    expect(errorLine?.content).toBe('warning');
  });
});
