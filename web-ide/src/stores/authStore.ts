import { create } from 'zustand';

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
    localStorage.setItem('ribix_token', token);
    set({ token, isAuthenticated: !!token });
  },

  clearAuth: () => {
    localStorage.removeItem('ribix_token');
    localStorage.removeItem('ribix_user');
    localStorage.removeItem('ribix_workspace');
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
      const response = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      const data = await response.json();
      
      localStorage.setItem('ribix_token', data.token);
      localStorage.setItem('ribix_user', JSON.stringify(data.user));
      localStorage.setItem('ribix_workspace', JSON.stringify(data.workspace));

      set({
        isAuthenticated: true,
        user: data.user,
        token: data.token,
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

  loginWithGitHub: async () => {
    set({ isLoading: true, error: null });

    try {
      // Redirect to GitHub OAuth
      window.location.href = 'http://localhost:3000/api/auth/github';
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
      const token = get().token;
      if (token) {
        await fetch('http://localhost:3000/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
      }

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