// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollaborationIndicator, RemoteCursor } from './CollaborationIndicator';

// The real collaboration store opens WebSocket connections via y-websocket on
// joinSession, which is unsuitable for unit tests. Mock the store module so we
// can control isConnected / users and spy on join/leave.
const mockJoinSession = vi.fn();
const mockLeaveSession = vi.fn();

let mockStoreState: {
  isConnected: boolean;
  users: any[];
} = { isConnected: false, users: [] };

vi.mock('../stores/collaborationStore', () => ({
  useCollaborationStore: () => ({
    isConnected: mockStoreState.isConnected,
    users: mockStoreState.users,
    joinSession: mockJoinSession,
    leaveSession: mockLeaveSession,
  }),
}));

beforeEach(() => {
  mockStoreState = { isConnected: false, users: [] };
  mockJoinSession.mockClear();
  mockLeaveSession.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CollaborationIndicator', () => {
  it('joins session on mount and leaves on unmount', () => {
    const { unmount } = render(<CollaborationIndicator fileId="file-1" />);

    expect(mockJoinSession).toHaveBeenCalledWith('file-1');
    expect(mockLeaveSession).not.toHaveBeenCalled();

    unmount();

    expect(mockLeaveSession).toHaveBeenCalledWith('file-1');
  });

  it('re-joins when fileId changes', () => {
    const { rerender } = render(<CollaborationIndicator fileId="file-1" />);

    expect(mockJoinSession).toHaveBeenCalledWith('file-1');

    rerender(<CollaborationIndicator fileId="file-2" />);

    // effect cleanup leaves old session, new effect joins new session
    expect(mockLeaveSession).toHaveBeenCalledWith('file-1');
    expect(mockJoinSession).toHaveBeenCalledWith('file-2');
  });

  it('renders nothing when not connected', () => {
    const { container } = render(<CollaborationIndicator fileId="file-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when connected but no users', () => {
    mockStoreState = { isConnected: true, users: [] };
    const { container } = render(<CollaborationIndicator fileId="file-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when not connected but has users', () => {
    mockStoreState = {
      isConnected: false,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, lastSeen: 0 },
      ],
    };
    const { container } = render(<CollaborationIndicator fileId="file-1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders collaborator list when connected with users', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, file: 'main.ts', lastSeen: 0 },
      ],
    };

    render(<CollaborationIndicator fileId="file-1" />);

    expect(screen.getByText(/Collaborators/)).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Editing main.ts')).toBeTruthy();
  });

  it('shows total collaborator count including self (users.length + 1)', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, lastSeen: 0 },
        { user: { id: 'u2', name: 'Bob', color: '#4ECDC4' }, lastSeen: 0 },
      ],
    };

    render(<CollaborationIndicator fileId="file-1" />);

    // 2 users + 1 self = 3
    expect(screen.getByText(/Collaborators \(3\)/)).toBeTruthy();
  });

  it('shows "Viewing" when user has no file', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, lastSeen: 0 },
      ],
    };

    render(<CollaborationIndicator fileId="file-1" />);

    expect(screen.getByText('Viewing')).toBeTruthy();
  });

  it('renders first letter of user name capitalized in avatar', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'alice', color: '#FF6B6B' }, lastSeen: 0 },
      ],
    };

    const { container } = render(<CollaborationIndicator fileId="file-1" />);

    // The avatar circle contains the first letter capitalized
    expect(screen.getByText('A')).toBeTruthy();
    // avatar has circular border radius
    const avatar = Array.from(container.querySelectorAll('div')).find(
      (d) => d.style.borderRadius === '50%' && d.style.width === '24px',
    );
    expect(avatar).toBeTruthy();
    expect(avatar?.style.backgroundColor).toBe('#FF6B6B');
  });

  it('renders a pulse style element for each user', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, lastSeen: 0 },
      ],
    };

    const { container } = render(<CollaborationIndicator fileId="file-1" />);

    const pulse = Array.from(container.querySelectorAll('div')).find(
      (d) => d.style.animation === 'pulse 2s infinite',
    );
    expect(pulse).toBeTruthy();
    expect(pulse?.style.backgroundColor).toBe('#4ec9b0');
  });

  it('renders the pulse keyframes style tag', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, lastSeen: 0 },
      ],
    };

    const { container } = render(<CollaborationIndicator fileId="file-1" />);

    const styleTag = container.querySelector('style');
    expect(styleTag).toBeTruthy();
    expect(styleTag?.textContent).toContain('@keyframes pulse');
  });

  it('renders multiple users', () => {
    mockStoreState = {
      isConnected: true,
      users: [
        { user: { id: 'u1', name: 'Alice', color: '#FF6B6B' }, file: 'a.ts', lastSeen: 0 },
        { user: { id: 'u2', name: 'Bob', color: '#4ECDC4' }, lastSeen: 0 },
      ],
    };

    render(<CollaborationIndicator fileId="file-1" />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Editing a.ts')).toBeTruthy();
    expect(screen.getByText('Viewing')).toBeTruthy();
  });
});

describe('RemoteCursor', () => {
  it('renders a cursor at the given position with the given color', () => {
    const { container } = render(<RemoteCursor position={120} color="#FF6B6B" name="Alice" />);

    const cursor = container.firstChild as HTMLElement;
    expect(cursor).toBeTruthy();
    expect(cursor.style.left).toBe('120px');
    expect(cursor.style.backgroundColor).toBe('#FF6B6B');
    expect(cursor.style.width).toBe('2px');
    expect(cursor.style.height).toBe('20px');
  });

  it('renders the name label above the cursor', () => {
    render(<RemoteCursor position={50} color="#4ECDC4" name="Bob" />);

    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('positions the name label at top -20px', () => {
    render(<RemoteCursor position={50} color="#4ECDC4" name="Bob" />);

    const label = screen.getByText('Bob') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.style.top).toBe('-20px');
    expect(label.style.backgroundColor).toBe('#4ECDC4');
  });

  it('has pointerEvents none so it does not intercept clicks', () => {
    const { container } = render(<RemoteCursor position={50} color="#4ECDC4" name="Bob" />);

    const cursor = container.firstChild as HTMLElement;
    expect(cursor.style.pointerEvents).toBe('none');
  });
});
