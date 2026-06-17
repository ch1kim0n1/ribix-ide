/**
 * Real-time Collaboration System using Yjs (CRDT)
 * Supports live cursors, presence, and shared editing
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import { create } from 'zustand';
import { collaborationWebSocketUrl } from '../lib/api';

export interface UserPresence {
  user: {
    id: string;
    name: string;
    color: string;
    avatar?: string;
  };
  cursor?: {
    position: number;
    selection?: { from: number; to: number };
  };
  file?: string;
  lastSeen: number;
}

export interface CollaborationSession {
  id: string;
  document: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  users: Map<string, UserPresence>;
  isConnected: boolean;
}

export class CollaborationManager {
  private sessions: Map<string, CollaborationSession> = new Map();
  readonly userId: string;
  private readonly userName: string;
  private readonly userColor: string;

  constructor(userId: string, userName: string, userColor?: string) {
    this.userId = userId;
    this.userName = userName;
    this.userColor = userColor || this.generateColor();
  }

  private generateColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Join a collaboration session for a file
   */
  joinSession(
    fileId: string,
    websocketUrl: string,
    onStatusChange?: (connected: boolean) => void,
  ): CollaborationSession {
    if (this.sessions.has(fileId)) {
      return this.sessions.get(fileId)!;
    }

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(
      websocketUrl,
      fileId,
      doc,
      {
        connect: true,
        params: {
          userId: this.userId,
          userName: this.userName,
          userColor: this.userColor,
        },
      }
    );

    const awareness = provider.awareness;

    // Set local user state
    awareness.setLocalStateField('user', {
      id: this.userId,
      name: this.userName,
      color: this.userColor,
    });

    // Track other users
    const users = new Map<string, UserPresence>();
    awareness.on('change', () => {
      const states = awareness.getStates() as Map<number, any>;
      users.clear();
      
      states.forEach((state, clientId) => {
        if (state.user && clientId !== awareness.clientID) {
          users.set(clientId.toString(), {
            user: state.user,
            cursor: state.cursor,
            file: state.file,
            lastSeen: Date.now(),
          });
        }
      });
    });

    const session: CollaborationSession = {
      id: fileId,
      document: doc,
      provider,
      awareness,
      users,
      isConnected: false,
    };

    provider.on('status', (event: { status: string }) => {
      session.isConnected = event.status === 'connected';
      onStatusChange?.(session.isConnected);
    });

    this.sessions.set(fileId, session);
    return session;
  }

  /**
   * Leave a collaboration session
   */
  leaveSession(fileId: string): void {
    const session = this.sessions.get(fileId);
    if (session) {
      session.provider.disconnect();
      session.document.destroy();
      this.sessions.delete(fileId);
    }
  }

  /**
   * Get a session
   */
  getSession(fileId: string): CollaborationSession | undefined {
    return this.sessions.get(fileId);
  }

  /**
   * Update cursor position
   */
  updateCursor(fileId: string, position: number, selection?: { from: number; to: number }): void {
    const session = this.sessions.get(fileId);
    if (session) {
      session.awareness.setLocalStateField('cursor', { position, selection });
      session.awareness.setLocalStateField('file', fileId);
    }
  }

  /**
   * Get all users in a session
   */
  getUsers(fileId: string): UserPresence[] {
    const session = this.sessions.get(fileId);
    return session ? Array.from(session.users.values()) : [];
  }

  /**
   * Get shared text document
   */
  getTextDocument(fileId: string): Y.Text | undefined {
    const session = this.sessions.get(fileId);
    return session ? session.document.getText('content') : undefined;
  }

  /**
   * Disconnect all sessions
   */
  disconnectAll(): void {
    this.sessions.forEach((session) => {
      session.provider.disconnect();
      session.document.destroy();
    });
    this.sessions.clear();
  }
}

/**
 * Collaboration Store for React
 */

interface CollaborationState {
  isConnected: boolean;
  currentSession: string | null;
  users: UserPresence[];
  cursors: Map<string, { position: number; selection?: { from: number; to: number } }>;
  
  // Actions
  joinSession: (fileId: string) => void;
  leaveSession: (fileId: string) => void;
  updateCursor: (position: number, selection?: { from: number; to: number }) => void;
  setConnected: (connected: boolean) => void;
}

let collaborationManager: CollaborationManager | null = null;

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  isConnected: false,
  currentSession: null,
  users: [],
  cursors: new Map(),

  joinSession: (fileId: string) => {
    if (!collaborationManager) {
      // Initialize with user info from auth
      const userId = localStorage.getItem('ribix_user_id') || `user-${Date.now()}`;
      const userName = localStorage.getItem('ribix_user_name') || 'Anonymous';
      collaborationManager = new CollaborationManager(userId, userName);
    }

    const session = collaborationManager.joinSession(
      fileId,
      collaborationWebSocketUrl(),
      (connected) => set({ isConnected: connected }),
    );

    set({
      currentSession: fileId,
      isConnected: session.isConnected,
    });

    // Update users periodically
    const interval = setInterval(() => {
      const users = collaborationManager?.getUsers(fileId) || [];
      set({ users });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  },

  leaveSession: (fileId: string) => {
    collaborationManager?.leaveSession(fileId);
    set({
      currentSession: null,
      users: [],
      cursors: new Map(),
    });
  },

  updateCursor: (position, selection) => {
    const { currentSession } = get();
    if (currentSession) {
      collaborationManager?.updateCursor(currentSession, position, selection);
      
      set((state) => {
        const cursors = new Map(state.cursors);
        cursors.set(collaborationManager!.userId, { position, selection });
        return { cursors };
      });
    }
  },

  setConnected: (connected) => set({ isConnected: connected }),
}));
