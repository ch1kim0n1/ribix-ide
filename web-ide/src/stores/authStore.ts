import { create } from 'zustand';
import { webIdeApiUrl } from '../lib/api';
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  withCredentials,
} from '../lib/authToken';

/**
 * C3: Auth token storage migration.
 *
 * The JWT is no longer stored in localStorage. It is kept in sessionStorage
 * (see src/lib/authToken.ts) as a fallback until the ribix backend sets an
 * httpOnly cookie on login. Only the non-sensitive `isAuthenticated` flag and
 * the user/workspace objects (no token) remain in localStorage so the UI can
 * restore the logged-in state across reloads without exposing the token.
 */
const AUTH_FLAG_KEY = 'ribix_authenticated';
const USER_KEY = 'ribix_user';
const WORKSPACE_KEY = 'ribix_workspace';

interface AuthState {
  isAuthenticated: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string;
  } | null;
  token: string | null;
  workspace: {
    id: string;
    name: string;
    role: string;
  } | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  setToken: (token: string) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  isAuthenticated: false,
  user: null,
  token: null,
  workspace: null,
  isLoading: false,
  error: null,

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  setToken: (token) => {
    // C3: token lives in sessionStorage (not localStorage). The non-sensitive
    // authenticated flag is mirrored to localStorage for UI restore on reload.
    setAuthToken(token);
    try {
      localStorage.setItem(AUTH_FLAG_KEY, '1');
    } catch {
      // ignore storage errors
    }
    set({ token, isAuthenticated: !!token });
  },

  clearAuth: () => {
    // C3: remove the token from sessionStorage and the non-sensitive UI flags
    // from localStorage. The token itself was never in localStorage.
    clearAuthToken();
    try {
      localStorage.removeItem(AUTH_FLAG_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(WORKSPACE_KEY);
    } catch {
      // ignore storage errors
    }
    set({
      isAuthenticated: false,
      user: null,
      token: null,
      workspace: null,
    });
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });

    try {
      // C3: credentials:'include' so the server's httpOnly auth cookie (when
      // supported) is set/sent automatically. The token in the JSON body is
      // still consumed as a fallback for backends that have not migrated.
      const response = await fetch(webIdeApiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        ...withCredentials,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Login failed');
      }

      const data = await response.json();

      // C3: token -> sessionStorage; non-sensitive user/workspace -> localStorage.
      if (data.token) setAuthToken(data.token);
      try {
        localStorage.setItem(AUTH_FLAG_KEY, '1');
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data.workspace));
      } catch {
        // ignore storage errors
      }

      set({
        isAuthenticated: true,
        user: data.user,
        token: data.token ?? null,
        workspace: data.workspace,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null });

    try {
      // C3: credentials:'include' for httpOnly cookie support.
      const response = await fetch(webIdeApiUrl('/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
        ...withCredentials,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Registration failed');
      }

      const data = await response.json();

      // C3: token -> sessionStorage; non-sensitive user/workspace -> localStorage.
      if (data.token) setAuthToken(data.token);
      try {
        localStorage.setItem(AUTH_FLAG_KEY, '1');
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data.workspace));
      } catch {
        // ignore storage errors
      }

      set({
        isAuthenticated: true,
        user: data.user,
        token: data.token ?? null,
        workspace: data.workspace,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Registration failed',
        isLoading: false,
      });
      throw error;
    }
  },

  loginWithGitHub: async () => {
    set({ isLoading: true, error: null });

    try {
      // Redirect to GitHub OAuth
      window.location.assign(webIdeApiUrl('/auth/github'));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'GitHub login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });

    try {
      // C3: send credentials so the server can clear its httpOnly cookie; the
      // Authorization header is still attached as a fallback for backends that
      // have not migrated to cookies.
      const token = get().token ?? getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(webIdeApiUrl('/auth/logout'), {
        method: 'POST',
        headers,
        ...withCredentials,
      });

      get().clearAuth();
      set({ isLoading: false });
    } catch (error) {
      console.error('Logout failed:', error);
      // Clear local auth even if server call fails
      get().clearAuth();
      set({ isLoading: false });
    }
  },
}));
