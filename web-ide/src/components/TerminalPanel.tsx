import React, { useRef, useEffect, useState } from 'react';
import { useTerminalStore } from '../stores/terminalStore';

interface TerminalPanelProps {
  onClose: () => void;
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const { lines, currentDirectory, executeCommand, clearHistory, isRunning } = useTerminalStore();
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new lines are added
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    // Focus input when terminal opens
    inputRef.current?.focus();
  }, []);

  const handleExecute = async () => {
    if (!input.trim() || isRunning) return;

    const command = input;
    setInput('');

    try {
      await executeCommand(command);
    } catch (error) {
      console.error('Command error:', error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleExecute();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const { commandHistory } = useTerminalStore.getState();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      if (newIndex === -1) {
        setInput('');
      } else {
        const { commandHistory } = useTerminalStore.getState();
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearHistory();
    }
  };

  const getLineColor = (type: string) => {
    switch (type) {
      case 'input':
        return '#4ec9b0';
      case 'error':
        return '#f14c4c';
      case 'output':
        return '#d4d4d4';
      default:
        return '#d4d4d4';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '300px',
      backgroundColor: '#1e1e1e',
      borderTop: '1px solid #3c3c3c',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #3c3c3c',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#252526',
      }}>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>
          💻 Terminal
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={clearHistory}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 8px',
            }}
          >
            Clear
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '16px',
              padding: '2px 8px',
            }}
          >
            ×
          </button>
        </div>
      </div>

      <div
        ref={terminalRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: '13px',
          lineHeight: '1.5',
        }}
      >
        {lines.length === 0 && (
          <div style={{ color: '#888' }}>
            Ribix IDE Terminal v1.0.0<br/>
            Type 'help' for available commands.<br/><br/>
          </div>
        )}

        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              color: getLineColor(line.type),
              marginBottom: '2px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {line.content}
          </div>
        ))}

        {isRunning && (
          <div style={{ color: '#888' }}>
            <span className="terminal-spinner">●</span> Running...
          </div>
        )}
      </div>

      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #3c3c3c',
        backgroundColor: '#252526',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ color: '#4ec9b0', fontFamily: 'monospace', fontSize: '13px' }}>
          {currentDirectory} $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          disabled={isRunning}
          placeholder="Enter command..."
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: '#d4d4d4',
            fontSize: '13px',
            fontFamily: 'Consolas, Monaco, monospace',
            outline: 'none',
          }}
        />
      </div>

      <style>{`
        .terminal-spinner {
          animation: blink 1s infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}