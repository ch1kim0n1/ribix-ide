import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal localStorage stub (collaborationStore reads user id/name from localStorage).
const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  writable: true,
  configurable: true,
});

// Track the most recently created mock provider so tests can emit events.
// vi.hoisted ensures these refs exist before the vi.mock factory runs.
const mockRefs = vi.hoisted(() => ({ provider: null as any, awareness: null as any }));

vi.mock('y-websocket', () => {
  // Use a class so `new WebsocketProvider(...)` returns the instance with
  // all the expected properties assigned to `this`.
  class MockWebsocketProvider {
    providerListeners: Record<string, Array<(arg: any) => void>> = {};
    awarenessListeners: Record<string, Array<(arg: any) => void>> = {};
    localState: Record<string, unknown> = {};
    awareness: any;
    url: any;
    room: any;
    doc: any;
    opts: any;
    on: any;
    disconnect: any;
    connect: any;
    destroy: any;

    constructor(url: any, room: any, doc: any, opts: any) {
      this.url = url;
      this.room = room;
      this.doc = doc;
      this.opts = opts;
      this.awareness = {
        clientID: 42,
        setLocalStateField: vi.fn((field: string, value: unknown) => {
          this.localState[field] = value;
        }),
        getLocalState: () => this.localState,
        on: vi.fn((event: string, cb: (arg: any) => void) => {
          (this.awarenessListeners[event] = this.awarenessListeners[event] || []).push(cb);
        }),
        getStates: vi.fn(() => new Map()),
        destroy: vi.fn(),
      };
      this.on = vi.fn((event: string, cb: (arg: any) => void) => {
        (this.providerListeners[event] = this.providerListeners[event] || []).push(cb);
      });
      this.disconnect = vi.fn();
      this.connect = vi.fn();
      this.destroy = vi.fn();
      mockRefs.provider = this;
      mockRefs.awareness = this.awareness;
    }

    __emit(event: string, arg: any) {
      (this.providerListeners[event] || []).forEach(cb => cb(arg));
    }
    __emitAwareness(event: string, arg: any) {
      (this.awarenessListeners[event] || []).forEach(cb => cb(arg));
    }
  }
  return { WebsocketProvider: MockWebsocketProvider as any };
});

// Reset module-level `collaborationManager` state per test by re-importing.
let useCollaborationStore: any;
let CollaborationManager: any;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.restoreAllMocks();
  mockRefs.provider = null;
  mockRefs.awareness = null;
  const mod = await import('./collaborationStore');
  useCollaborationStore = mod.useCollaborationStore;
  CollaborationManager = mod.CollaborationManager;
  useCollaborationStore.setState({
    isConnected: false,
    currentSession: null,
    users: [],
    cursors: new Map(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CollaborationManager', () => {
  it('constructs with userId, userName and a generated color', () => {
    const mgr = new CollaborationManager('u1', 'Alice');
    expect(mgr.userId).toBe('u1');
    expect((mgr as any).userName).toBe('Alice');
    expect((mgr as any).userColor).toMatch(/^#/);
  });

  it('uses provided color when given', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#123456');
    expect((mgr as any).userColor).toBe('#123456');
  });

  it('joinSession creates a new session and returns it', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const session = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    expect(session.id).toBe('file-1');
    expect(session.document).toBeDefined();
    expect(session.provider).toBeDefined();
    expect(session.awareness).toBeDefined();
    expect(session.users).toBeInstanceOf(Map);
    expect(session.isConnected).toBe(false);
  });

  it('joinSession returns existing session for the same fileId', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const first = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    const second = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    expect(second).toBe(first);
  });

  it('joinSession sets local user state on awareness', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#abcdef');
    mgr.joinSession('file-1', 'ws://localhost/collaboration');
    expect(mockRefs.awareness.setLocalStateField).toHaveBeenCalledWith('user', {
      id: 'u1',
      name: 'Alice',
      color: '#abcdef',
    });
  });

  it('joinSession status event updates isConnected and calls onStatusChange', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const onStatus = vi.fn();
    const session = mgr.joinSession('file-1', 'ws://localhost/collaboration', onStatus);
    mockRefs.provider.__emit('status', { status: 'connected' });
    expect(session.isConnected).toBe(true);
    expect(onStatus).toHaveBeenCalledWith(true);
    mockRefs.provider.__emit('status', { status: 'disconnected' });
    expect(session.isConnected).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(false);
  });

  it('joinSession awareness change populates users from other clients', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const session = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    const states = new Map([
      [42, { user: { id: 'u1', name: 'Alice', color: '#000' } }], // self — excluded
      [99, { user: { id: 'u2', name: 'Bob', color: '#fff' }, cursor: { position: 5 }, file: 'file-1' }],
    ]);
    mockRefs.awareness.getStates.mockReturnValue(states);
    mockRefs.provider.__emitAwareness('change', {});
    const users = Array.from(session.users.values()) as Array<{ user: { name: string }; cursor?: { position: number } }>;
    expect(users).toHaveLength(1);
    expect(users[0]!.user.name).toBe('Bob');
    expect(users[0]!.cursor?.position).toBe(5);
  });

  it('leaveSession disconnects provider, destroys doc, and removes session', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const session = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    const destroySpy = vi.spyOn(session.document, 'destroy');
    mgr.leaveSession('file-1');
    expect(session.provider.disconnect).toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalled();
    expect(mgr.getSession('file-1')).toBeUndefined();
  });

  it('leaveSession is a no-op for unknown fileId', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    expect(() => mgr.leaveSession('nope')).not.toThrow();
  });

  it('getSession returns undefined for unknown fileId', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    expect(mgr.getSession('missing')).toBeUndefined();
  });

  it('updateCursor sets cursor and file state on awareness', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    mgr.joinSession('file-1', 'ws://localhost/collaboration');
    mgr.updateCursor('file-1', 10, { from: 1, to: 5 });
    expect(mockRefs.awareness.setLocalStateField).toHaveBeenCalledWith('cursor', {
      position: 10,
      selection: { from: 1, to: 5 },
    });
    expect(mockRefs.awareness.setLocalStateField).toHaveBeenCalledWith('file', 'file-1');
  });

  it('updateCursor is a no-op when session does not exist', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    expect(() => mgr.updateCursor('nope', 1)).not.toThrow();
  });

  it('getUsers returns empty array for unknown session', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    expect(mgr.getUsers('missing')).toEqual([]);
  });

  it('getUsers returns array of users for a session', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const session = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    session.users.set('99', { user: { id: 'u2', name: 'Bob', color: '#fff' }, lastSeen: 1 });
    const users = mgr.getUsers('file-1');
    expect(users).toHaveLength(1);
    expect(users[0].user.name).toBe('Bob');
  });

  it('getTextDocument returns a Y.Text for an existing session', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    mgr.joinSession('file-1', 'ws://localhost/collaboration');
    const text = mgr.getTextDocument('file-1');
    expect(text).toBeDefined();
  });

  it('getTextDocument returns undefined for unknown session', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    expect(mgr.getTextDocument('missing')).toBeUndefined();
  });

  it('disconnectAll disconnects all sessions and clears the map', () => {
    const mgr = new CollaborationManager('u1', 'Alice', '#000000');
    const s1 = mgr.joinSession('file-1', 'ws://localhost/collaboration');
    const s2 = mgr.joinSession('file-2', 'ws://localhost/collaboration');
    mgr.disconnectAll();
    expect(s1.provider.disconnect).toHaveBeenCalled();
    expect(s2.provider.disconnect).toHaveBeenCalled();
    expect(mgr.getSession('file-1')).toBeUndefined();
    expect(mgr.getSession('file-2')).toBeUndefined();
  });
});

describe('useCollaborationStore', () => {
  it('starts disconnected with no session', () => {
    const s = useCollaborationStore.getState();
    expect(s.isConnected).toBe(false);
    expect(s.currentSession).toBeNull();
    expect(s.users).toEqual([]);
    expect(s.cursors).toBeInstanceOf(Map);
  });

  it('setConnected sets the isConnected flag', () => {
    useCollaborationStore.getState().setConnected(true);
    expect(useCollaborationStore.getState().isConnected).toBe(true);
    useCollaborationStore.getState().setConnected(false);
    expect(useCollaborationStore.getState().isConnected).toBe(false);
  });

  it('joinSession sets currentSession and initializes manager from localStorage', () => {
    localStorage.setItem('ribix_user_id', 'stored-id');
    localStorage.setItem('ribix_user_name', 'Stored Name');
    useCollaborationStore.getState().joinSession('file-1');
    const s = useCollaborationStore.getState();
    expect(s.currentSession).toBe('file-1');
    // The mock provider was constructed and tracked.
    expect(mockRefs.provider).not.toBeNull();
    expect(mockRefs.provider.room).toBe('file-1');
  });

  it('joinSession returns a cleanup function', () => {
    const cleanup = useCollaborationStore.getState().joinSession('file-1');
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('joinSession status callback updates isConnected', () => {
    useCollaborationStore.getState().joinSession('file-1');
    expect(useCollaborationStore.getState().isConnected).toBe(false);
    mockRefs.provider.__emit('status', { status: 'connected' });
    expect(useCollaborationStore.getState().isConnected).toBe(true);
  });

  it('leaveSession clears currentSession, users, and cursors', () => {
    useCollaborationStore.getState().joinSession('file-1');
    useCollaborationStore.getState().leaveSession('file-1');
    const s = useCollaborationStore.getState();
    expect(s.currentSession).toBeNull();
    expect(s.users).toEqual([]);
    expect(s.cursors.size).toBe(0);
  });

  it('leaveSession calls manager.leaveSession which disconnects provider', () => {
    useCollaborationStore.getState().joinSession('file-1');
    useCollaborationStore.getState().leaveSession('file-1');
    expect(mockRefs.provider.disconnect).toHaveBeenCalled();
  });

  it('updateCursor updates cursors map when a session is active', () => {
    useCollaborationStore.getState().joinSession('file-1');
    useCollaborationStore.getState().updateCursor(15, { from: 10, to: 20 });
    const cursors = useCollaborationStore.getState().cursors;
    expect(cursors.size).toBe(1);
    const entry = cursors.get('stored-id') ?? cursors.get(Array.from(cursors.keys())[0]);
    expect(entry.position).toBe(15);
    expect(entry.selection).toEqual({ from: 10, to: 20 });
  });

  it('updateCursor is a no-op when no session is active', () => {
    useCollaborationStore.getState().updateCursor(5);
    expect(useCollaborationStore.getState().cursors.size).toBe(0);
  });
});
