// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIAssistantPanel } from './AIAssistantPanel';
import { useAdvancedAIStore } from '../stores/advancedAIStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useAdvancedAIStore.setState({
    isProcessing: false,
    currentTask: null,
    results: null,
    error: null,
    generateCode: vi.fn().mockResolvedValue(undefined),
    refactorCode: vi.fn().mockResolvedValue(undefined),
    debugCode: vi.fn().mockResolvedValue(undefined),
    reviewCode: vi.fn().mockResolvedValue(undefined),
    generateDocumentation: vi.fn().mockResolvedValue(undefined),
    explainCode: vi.fn().mockResolvedValue(undefined),
    generateTests: vi.fn().mockResolvedValue(undefined),
    optimizeCode: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AIAssistantPanel', () => {
  it('renders the header and close button', () => {
    const onClose = vi.fn();
    render(<AIAssistantPanel onClose={onClose} />);
    expect(screen.getByText('🧠 AI Assistant')).toBeTruthy();
    expect(screen.getByText('×')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<AIAssistantPanel onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders all five tabs', () => {
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText('generate')).toBeTruthy();
    expect(screen.getByText('refactor')).toBeTruthy();
    expect(screen.getByText('debug')).toBeTruthy();
    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.getByText('docs')).toBeTruthy();
  });

  it('defaults to the generate tab', () => {
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('e.g., Create a function that validates email addresses...')).toBeTruthy();
    expect(screen.getByText('Generate Code')).toBeTruthy();
  });

  it('switches tabs on click', () => {
    render(<AIAssistantPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('refactor'));
    expect(screen.getByText('Refactoring Type:')).toBeTruthy();
    expect(screen.getByText('Refactor Code')).toBeTruthy();
  });

  it('disables Generate Code button when prompt is empty', () => {
    render(<AIAssistantPanel onClose={vi.fn()} />);
    const btn = screen.getByText('Generate Code');
    expect(btn.getAttribute('disabled')).not.toBeNull();
  });

  it('enables Generate Code button when prompt is provided', () => {
    render(<AIAssistantPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Create a function that validates email addresses...'), {
      target: { value: 'make a function' },
    });
    const btn = screen.getByText('Generate Code');
    expect(btn.getAttribute('disabled')).toBeNull();
  });

  it('calls generateCode when Generate Code is clicked', async () => {
    const { generateCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Create a function that validates email addresses...'), {
      target: { value: 'make a function' },
    });
    fireEvent.click(screen.getByText('Generate Code'));
    await vi.waitFor(() => {
      expect(generateCode).toHaveBeenCalledWith({
        prompt: 'make a function',
        context: { surroundingCode: 'const x = 1;', language: 'typescript' },
      });
    });
  });

  it('does not call generateCode when prompt is whitespace', () => {
    const { generateCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Create a function that validates email addresses...'), {
      target: { value: '   ' },
    });
    const btn = screen.getByText('Generate Code');
    expect(btn.getAttribute('disabled')).not.toBeNull();
    expect(generateCode).not.toHaveBeenCalled();
  });

  it('calls refactorCode when Refactor Code is clicked', async () => {
    const { refactorCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('refactor'));
    fireEvent.click(screen.getByText('Refactor Code'));
    await vi.waitFor(() => {
      expect(refactorCode).toHaveBeenCalledWith({
        code: 'const x = 1;',
        language: 'typescript',
        refactoringType: 'optimize',
      });
    });
  });

  it('changes refactoring type via select', async () => {
    const { refactorCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('refactor'));
    fireEvent.change(screen.getByDisplayValue('Optimize Performance'), {
      target: { value: 'simplify' },
    });
    fireEvent.click(screen.getByText('Refactor Code'));
    await vi.waitFor(() => {
      expect(refactorCode).toHaveBeenCalledWith(
        expect.objectContaining({ refactoringType: 'simplify' }),
      );
    });
  });

  it('disables Refactor Code button when currentCode is empty', () => {
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="" />);
    fireEvent.click(screen.getByText('refactor'));
    const btn = screen.getByText('Refactor Code');
    expect(btn.getAttribute('disabled')).not.toBeNull();
  });

  it('calls debugCode when Debug Code is clicked', async () => {
    const { debugCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('debug'));
    fireEvent.click(screen.getByText('Debug Code'));
    await vi.waitFor(() => {
      expect(debugCode).toHaveBeenCalledWith({ code: 'const x = 1;', language: 'typescript' });
    });
  });

  it('calls reviewCode when Review Code is clicked', async () => {
    const { reviewCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('review'));
    fireEvent.click(screen.getByText('Review Code'));
    await vi.waitFor(() => {
      expect(reviewCode).toHaveBeenCalledWith({
        code: 'const x = 1;',
        language: 'typescript',
        reviewType: 'comprehensive',
      });
    });
  });

  it('renders the docs tab buttons', () => {
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('docs'));
    expect(screen.getByText('Explain Code')).toBeTruthy();
    expect(screen.getByText('Generate Documentation')).toBeTruthy();
    expect(screen.getByText('Generate Tests')).toBeTruthy();
    expect(screen.getByText('Optimize Performance')).toBeTruthy();
  });

  it('calls explainCode when Explain Code is clicked', async () => {
    const { explainCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" currentLanguage="javascript" />);
    fireEvent.click(screen.getByText('docs'));
    fireEvent.click(screen.getByText('Explain Code'));
    await vi.waitFor(() => {
      expect(explainCode).toHaveBeenCalledWith('const x = 1;', 'javascript');
    });
  });

  it('calls generateDocumentation when Generate Documentation is clicked', async () => {
    const { generateDocumentation } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('docs'));
    fireEvent.click(screen.getByText('Generate Documentation'));
    await vi.waitFor(() => {
      expect(generateDocumentation).toHaveBeenCalledWith('const x = 1;', 'typescript');
    });
  });

  it('calls generateTests when Generate Tests is clicked', async () => {
    const { generateTests } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('docs'));
    fireEvent.click(screen.getByText('Generate Tests'));
    await vi.waitFor(() => {
      expect(generateTests).toHaveBeenCalledWith('const x = 1;', 'typescript');
    });
  });

  it('calls optimizeCode when Optimize Performance is clicked', async () => {
    const { optimizeCode } = useAdvancedAIStore.getState();
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="const x = 1;" />);
    fireEvent.click(screen.getByText('docs'));
    fireEvent.click(screen.getByText('Optimize Performance'));
    await vi.waitFor(() => {
      expect(optimizeCode).toHaveBeenCalledWith('const x = 1;', 'typescript');
    });
  });

  it('disables docs tab buttons when currentCode is empty', () => {
    render(<AIAssistantPanel onClose={vi.fn()} currentCode="" />);
    fireEvent.click(screen.getByText('docs'));
    expect(screen.getByText('Explain Code').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText('Generate Documentation').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText('Generate Tests').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText('Optimize Performance').getAttribute('disabled')).not.toBeNull();
  });

  it('shows processing indicator with currentTask when isProcessing', () => {
    useAdvancedAIStore.setState({ isProcessing: true, currentTask: 'Generating code...' });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText('Generating code...')).toBeTruthy();
  });

  it('shows Generating... label when processing on generate tab', () => {
    useAdvancedAIStore.setState({ isProcessing: true });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText('Generating...')).toBeTruthy();
  });

  it('shows error message when error is set', () => {
    useAdvancedAIStore.setState({ error: 'Something went wrong' });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders string results in a pre block', () => {
    useAdvancedAIStore.setState({ results: 'generated code here' });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText('generated code here')).toBeTruthy();
  });

  it('renders object results as JSON', () => {
    useAdvancedAIStore.setState({ results: { foo: 'bar' } });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.getByText(/"foo": "bar"/)).toBeTruthy();
  });

  it('does not render results while processing', () => {
    useAdvancedAIStore.setState({ isProcessing: true, results: 'should not show' });
    render(<AIAssistantPanel onClose={vi.fn()} />);
    expect(screen.queryByText('should not show')).toBeNull();
  });
});
