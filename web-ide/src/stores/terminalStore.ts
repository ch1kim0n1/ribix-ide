import { create } from 'zustand';
import { webIdeApiUrl } from '../lib/api';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error';
  content: string;
  timestamp: number;
}

interface TerminalState {
  lines: TerminalLine[];
  currentDirectory: string;
  commandHistory: string[];
  historyIndex: number;
  isRunning: boolean;
  
  // Actions
  executeCommand: (command: string) => Promise<void>;
  clearHistory: () => void;
  setCurrentDirectory: (dir: string) => void;
  addLine: (line: Omit<TerminalLine, 'id' | 'timestamp'>) => void;
  setRunning: (running: boolean) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  lines: [],
  currentDirectory: '/workspace',
  commandHistory: [],
  historyIndex: -1,
  isRunning: false,

  setCurrentDirectory: (dir) => set({ currentDirectory: dir }),

  setRunning: (running) => set({ isRunning: running }),

  addLine: (line) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          ...line,
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
        },
      ],
    })),

  clearHistory: () => set({ lines: [] }),

  executeCommand: async (command: string) => {
    const { addLine, setRunning, currentDirectory, commandHistory } = get();
    
    setRunning(true);
    
    // Add input line
    addLine({
      type: 'input',
      content: `$ ${currentDirectory} ${command}`,
    });

    // Add to history
    if (command.trim()) {
      set((state) => ({
        commandHistory: [...state.commandHistory, command],
        historyIndex: state.commandHistory.length,
      }));
    }

    try {
      const response = await fetch(webIdeApiUrl('/terminal/execute'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          cwd: currentDirectory,
        }),
      });

      if (!response.ok) {
        throw new Error('Command execution failed');
      }

      const data = await response.json();
      
      // Add output lines
      if (data.output) {
        addLine({
          type: 'output',
          content: data.output,
        });
      }

      if (data.error) {
        addLine({
          type: 'error',
          content: data.error,
        });
      }

      // Update current directory if it changed
      if (data.cwd && data.cwd !== currentDirectory) {
        set({ currentDirectory: data.cwd });
      }
    } catch (error) {
      addLine({
        type: 'error',
        content: error instanceof Error ? error.message : 'Command execution failed',
      });
    } finally {
      setRunning(false);
    }
  },
}));
