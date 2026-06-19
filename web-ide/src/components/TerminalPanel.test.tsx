// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalPanel } from './TerminalPanel';
import { useTerminalStore } from '../stores/terminalStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useTerminalStore.setState({
    lines: [],
    currentDirectory: '/workspace',
    commandHistory: [],
    historyIndex: -1,
    isRunning: false,
    executeCommand: vi.fn().mockResolvedValue(undefined),
    clearHistory: vi.fn(),
    setCurrentDirectory: vi.fn(),
    addLine: vi.fn(),
    setRunning: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TerminalPanel', () => {
  it('renders the header, Clear and close buttons', () => {
    render(<TerminalPanel onClose={vi.fn()} />);
    expect(screen.getByText('💻 Terminal')).toBeTruthy();
    expect(screen.getByText('Clear')).toBeTruthy();
    expect(screen.getByText('×')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<TerminalPanel onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls clearHistory when Clear is clicked', () => {
    const { clearHistory } = useTerminalStore.getState();
    render(<TerminalPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });

  it('renders the welcome message when there are no lines', () => {
    const { container } = render(<TerminalPanel onClose={vi.fn()} />);
    expect(container.textContent).toContain('Ribix IDE Terminal v1.0.0');
    expect(container.textContent).toContain("Type 'help' for available commands.");
  });

  it('renders terminal lines with their content', () => {
    useTerminalStore.setState({
      lines: [
        { id: '1', type: 'input', content: '$ /workspace ls', timestamp: 1000 },
        { id: '2', type: 'output', content: 'file.txt', timestamp: 2000 },
        { id: '3', type: 'error', content: 'boom', timestamp: 3000 },
      ],
    });
    render(<TerminalPanel onClose={vi.fn()} />);
    expect(screen.getByText('$ /workspace ls')).toBeTruthy();
    expect(screen.getByText('file.txt')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('renders the current directory prompt', () => {
    useTerminalStore.setState({ currentDirectory: '/home/user' });
    render(<TerminalPanel onClose={vi.fn()} />);
    expect(screen.getByText('/home/user $')).toBeTruthy();
  });

  it('calls executeCommand when Enter is pressed with input', async () => {
    const { executeCommand } = useTerminalStore.getState();
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...');
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(executeCommand).toHaveBeenCalledWith('ls -la');
    });
  });

  it('does not call executeCommand when input is whitespace', () => {
    const { executeCommand } = useTerminalStore.getState();
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('does not call executeCommand when isRunning', () => {
    useTerminalStore.setState({ isRunning: true });
    const { executeCommand } = useTerminalStore.getState();
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...');
    expect(input.getAttribute('disabled')).not.toBeNull();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('clears input after executing a command', async () => {
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'pwd' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('navigates command history with ArrowUp', () => {
    useTerminalStore.setState({ commandHistory: ['ls', 'pwd', 'cat'] });
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('cat');
  });

  it('navigates further back in history with repeated ArrowUp', () => {
    useTerminalStore.setState({ commandHistory: ['ls', 'pwd', 'cat'] });
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('pwd');
  });

  it('clears input when navigating past the end with ArrowDown', () => {
    useTerminalStore.setState({ commandHistory: ['ls', 'pwd'] });
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('');
  });

  it('navigates back down in history with ArrowDown', () => {
    useTerminalStore.setState({ commandHistory: ['ls', 'pwd', 'cat'] });
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('cat');
  });

  it('clears history on Ctrl+L', () => {
    const { clearHistory } = useTerminalStore.getState();
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...');
    fireEvent.keyDown(input, { key: 'l', ctrlKey: true });
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });

  it('shows running indicator when isRunning', () => {
    useTerminalStore.setState({ isRunning: true });
    render(<TerminalPanel onClose={vi.fn()} />);
    expect(screen.getByText('Running...')).toBeTruthy();
  });

  it('logs error when executeCommand throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useTerminalStore.setState({ executeCommand: vi.fn().mockRejectedValue(new Error('boom')) });
    render(<TerminalPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Enter command...');
    fireEvent.change(input, { target: { value: 'fail' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Command error:', expect.any(Error));
    });
  });
});
