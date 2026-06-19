// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { useFileSystemStore } from '../stores/fileSystemStore';

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob(['data'], { type: 'application/zip' })),
  } as Response;
}

function makeRoot() {
  return {
    name: 'workspace',
    path: '/',
    type: 'directory' as const,
    children: [
      {
        name: 'src',
        path: '/src',
        type: 'directory' as const,
        children: [
          {
            name: 'index.ts',
            path: '/src/index.ts',
            type: 'file' as const,
            content: 'console.log("hi")',
            language: 'typescript',
            lastModified: 1000,
          },
        ],
      },
      {
        name: 'README.md',
        path: '/README.md',
        type: 'file' as const,
        content: '# Project',
        language: 'markdown',
        lastModified: 2000,
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useFileSystemStore.setState({
    root: makeRoot(),
    currentPath: [],
    isLoading: false,
    error: null,
    persistenceEnabled: false,
  });
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileExplorer', () => {
  it('renders the EXPLORER header and toolbar buttons', () => {
    render(<FileExplorer onFileSelect={vi.fn()} />);
    expect(screen.getByText('EXPLORER')).toBeTruthy();
    expect(screen.getByTitle('Download workspace as ZIP (escape hatch)')).toBeTruthy();
    expect(screen.getByTitle('New file or directory')).toBeTruthy();
  });

  it('renders the root workspace directory with children count', () => {
    const { container } = render(<FileExplorer onFileSelect={vi.fn()} />);
    // root is expanded by default; workspace label visible
    expect(screen.getByText('workspace')).toBeTruthy();
    // src directory and README.md should be visible since root is expanded
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();
    // workspace has 2 children → count "2" shown
    const counts = container.querySelectorAll('span');
    expect(Array.from(counts).some((s) => s.textContent === '2')).toBe(true);
  });

  it('expands and collapses a directory on click', () => {
    render(<FileExplorer onFileSelect={vi.fn()} />);

    // src is not expanded initially → index.ts not visible
    expect(screen.queryByText('index.ts')).toBeNull();

    // click src to expand
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeTruthy();

    // click src again to collapse
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('index.ts')).toBeNull();
  });

  it('calls onFileSelect when clicking a file with content', () => {
    const onFileSelect = vi.fn();
    render(<FileExplorer onFileSelect={onFileSelect} />);

    fireEvent.click(screen.getByText('README.md'));

    expect(onFileSelect).toHaveBeenCalledWith('/README.md', '# Project', 'markdown');
  });

  it('does not call onFileSelect when clicking a file without content', () => {
    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        path: '/',
        type: 'directory',
        children: [
          { name: 'empty.txt', path: '/empty.txt', type: 'file', content: '', language: 'plaintext' },
        ],
      },
    });

    const onFileSelect = vi.fn();
    render(<FileExplorer onFileSelect={onFileSelect} />);

    fireEvent.click(screen.getByText('empty.txt'));
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('uses plaintext language fallback when language is missing', () => {
    useFileSystemStore.setState({
      root: {
        name: 'workspace',
        path: '/',
        type: 'directory',
        children: [
          { name: 'noflang.txt', path: '/noflang.txt', type: 'file', content: 'hello' },
        ],
      },
    });

    const onFileSelect = vi.fn();
    render(<FileExplorer onFileSelect={onFileSelect} />);

    fireEvent.click(screen.getByText('noflang.txt'));
    expect(onFileSelect).toHaveBeenCalledWith('/noflang.txt', 'hello', 'plaintext');
  });

  it('highlights the active file when currentFile matches', () => {
    const { container } = render(
      <FileExplorer onFileSelect={vi.fn()} currentFile="/README.md" />,
    );

    // The active row has backgroundColor #37373d (happy-dom may keep hex or
    // convert to rgb, so accept either form).
    const activeRow = Array.from(container.querySelectorAll('div')).find(
      (d) => {
        const bg = d.style.backgroundColor;
        return bg === '#37373d' || bg === 'rgb(55, 55, 61)';
      },
    );
    expect(activeRow).toBeTruthy();
    expect(activeRow?.textContent).toContain('README.md');
  });

  it('shows the create menu when + button is clicked', () => {
    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));

    expect(screen.getByText('File')).toBeTruthy();
    expect(screen.getByText('Directory')).toBeTruthy();
    expect(screen.getByText('Create')).toBeTruthy();
    expect(screen.getByPlaceholderText('Name...')).toBeTruthy();
  });

  it('hides the create menu when + button is clicked again', () => {
    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    expect(screen.getByText('Create')).toBeTruthy();

    fireEvent.click(screen.getByTitle('New file or directory'));
    expect(screen.queryByText('Create')).toBeNull();
  });

  it('creates a file via Create button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    fireEvent.change(screen.getByPlaceholderText('Name...'), { target: { value: 'newfile.ts' } });
    fireEvent.click(screen.getByText('Create'));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/web-ide/filesystem/write',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('creates a directory when Directory type is selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    fireEvent.click(screen.getByText('Directory'));
    fireEvent.change(screen.getByPlaceholderText('Name...'), { target: { value: 'newdir' } });
    fireEvent.click(screen.getByText('Create'));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/web-ide/filesystem/directory',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('creates a file when Enter key is pressed in the name input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    const input = screen.getByPlaceholderText('Name...');
    fireEvent.change(input, { target: { value: 'enter.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  it('closes the create menu when Escape key is pressed', () => {
    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    const input = screen.getByPlaceholderText('Name...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByText('Create')).toBeNull();
  });

  it('does not create when name is empty or whitespace', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    fireEvent.change(screen.getByPlaceholderText('Name...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Create'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows alert when createFile fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('New file or directory'));
    fireEvent.change(screen.getByPlaceholderText('Name...'), { target: { value: 'fail.ts' } });
    fireEvent.click(screen.getByText('Create'));

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to create item');
    });
  });

  it('deletes a file via context menu when confirm is accepted', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    // Right-click on README.md row
    const readmeRow = screen.getByText('README.md').closest('div');
    expect(readmeRow).toBeTruthy();
    fireEvent.contextMenu(readmeRow!);

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/web-ide/filesystem/delete',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/README.md', isDirectory: false }),
        }),
      );
    });
  });

  it('does not delete when confirm is rejected', () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    const readmeRow = screen.getByText('README.md').closest('div');
    fireEvent.contextMenu(readmeRow!);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not delete the workspace root via context menu', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    const workspaceRow = screen.getByText('workspace').closest('div');
    fireEvent.contextMenu(workspaceRow!);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deletes a directory via context menu', async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    const srcRow = screen.getByText('src').closest('div');
    fireEvent.contextMenu(srcRow!);

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/web-ide/filesystem/delete',
        expect.objectContaining({
          body: JSON.stringify({ path: '/src', isDirectory: true }),
        }),
      );
    });
  });

  it('shows alert when delete fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    const readmeRow = screen.getByText('README.md').closest('div');
    fireEvent.contextMenu(readmeRow!);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to delete item');
    });
  });

  it('downloads workspace when download button is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse(new Blob(['data'], { type: 'application/zip' })),
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true, configurable: true });

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Download workspace as ZIP (escape hatch)'));

    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/web-ide/filesystem/export.zip', expect.anything());
    });
  });

  it('shows alert when download fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}, false, 500));

    render(<FileExplorer onFileSelect={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Download workspace as ZIP (escape hatch)'));

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to download workspace');
    });
  });

  it('renders directory icons (📁 when collapsed, 📂 when expanded)', () => {
    const { container } = render(<FileExplorer onFileSelect={vi.fn()} />);

    // Root workspace is expanded by default (📂); src is collapsed (📁).
    expect(container.textContent).toContain('📁');
    expect(container.textContent).toContain('📂');

    // Expand src → src now shows 📂
    fireEvent.click(screen.getByText('src'));
    expect(container.textContent).toContain('📂');

    // Collapse root → root now shows 📁
    fireEvent.click(screen.getByText('workspace'));
    expect(container.textContent).toContain('📁');
  });

  it('renders file icon (📄) for files', () => {
    const { container } = render(<FileExplorer onFileSelect={vi.fn()} />);
    expect(container.textContent).toContain('📄');
  });
});
