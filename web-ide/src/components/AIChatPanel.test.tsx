// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIChatPanel } from './AIChatPanel';
import { useAIChatStore } from '../stores/aiChatStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useAIChatStore.setState({
    messages: [],
    isLoading: false,
    currentProvider: {
      provider: 'ribix',
      model: 'claude-3-sonnet-20240229',
      temperature: 0.7,
      maxTokens: 4096,
    },
    providers: {},
    addMessage: vi.fn((message) => {
      useAIChatStore.setState((state) => ({ messages: [...state.messages, message] }));
    }),
    clearMessages: vi.fn(() => useAIChatStore.setState({ messages: [] })),
    setProvider: vi.fn(),
    setLoading: vi.fn((loading) => useAIChatStore.setState({ isLoading: loading })),
    sendMessage: vi.fn().mockResolvedValue('response'),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AIChatPanel', () => {
  it('renders the header with provider info', () => {
    render(<AIChatPanel onClose={vi.fn()} />);
    expect(screen.getByText('🤖 Ribix AI')).toBeTruthy();
    expect(screen.getByText('ribix • claude-3-sonnet-20240229')).toBeTruthy();
  });

  it('renders the close button and calls onClose', () => {
    const onClose = vi.fn();
    render(<AIChatPanel onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no messages', () => {
    const { container } = render(<AIChatPanel onClose={vi.fn()} />);
    expect(screen.getByText('Ask Ribix AI for help with:')).toBeTruthy();
    expect(container.textContent).toContain('Code explanations');
    expect(container.textContent).toContain('Bug fixes');
  });

  it('renders existing messages', () => {
    useAIChatStore.setState({
      messages: [
        { role: 'user', content: 'Hello there', timestamp: 1000 },
        { role: 'assistant', content: 'Hi!', timestamp: 2000 },
      ],
    });
    render(<AIChatPanel onClose={vi.fn()} />);
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.getByText('Hi!')).toBeTruthy();
  });

  it('disables Send button when input is empty', () => {
    render(<AIChatPanel onClose={vi.fn()} />);
    expect(screen.getByText('Send').getAttribute('disabled')).not.toBeNull();
  });

  it('enables Send button when input has text', () => {
    render(<AIChatPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)'), {
      target: { value: 'help me' },
    });
    expect(screen.getByText('Send').getAttribute('disabled')).toBeNull();
  });

  it('shows character count for input', () => {
    render(<AIChatPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)'), {
      target: { value: 'abc' },
    });
    expect(screen.getByText('3 characters')).toBeTruthy();
  });

  it('calls sendMessage when Send is clicked and clears input', async () => {
    const { sendMessage } = useAIChatStore.getState();
    render(<AIChatPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)');
    fireEvent.change(input, { target: { value: 'write code' } });
    fireEvent.click(screen.getByText('Send'));
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('write code');
    });
  });

  it('does not call sendMessage when input is whitespace', () => {
    const { sendMessage } = useAIChatStore.getState();
    render(<AIChatPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText('Send'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not call sendMessage when isLoading', () => {
    useAIChatStore.setState({ isLoading: true });
    const { sendMessage } = useAIChatStore.getState();
    render(<AIChatPanel onClose={vi.fn()} />);
    // input is disabled while loading; Send button shows Sending...
    expect(screen.getByText('Sending...')).toBeTruthy();
    expect(screen.getByText('Sending...').getAttribute('disabled')).not.toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows loading indicator when isLoading', () => {
    useAIChatStore.setState({ isLoading: true });
    const { container } = render(<AIChatPanel onClose={vi.fn()} />);
    // three bouncing dots
    const dots = container.querySelectorAll('div[style*="border-radius: 50%"]');
    expect(dots.length).toBe(3);
  });

  it('adds error message when sendMessage throws', async () => {
    const { addMessage } = useAIChatStore.getState();
    useAIChatStore.setState({
      sendMessage: vi.fn().mockRejectedValue(new Error('fail')),
    });
    render(<AIChatPanel onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)');
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Send'));
    await vi.waitFor(() => {
      expect(addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        }),
      );
    });
  });

  it('disables textarea when isLoading', () => {
    useAIChatStore.setState({ isLoading: true });
    render(<AIChatPanel onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Ask Ribix AI... (Enter to send, Shift+Enter for new line)');
    expect(textarea.getAttribute('disabled')).not.toBeNull();
  });
});
