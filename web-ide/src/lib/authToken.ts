/**
 * Auth token storage helper (C3 — migrate auth from localStorage to httpOnly cookies).
 *
 * SECURITY GOAL
 * -------------
 * JWTs should ideally live in an httpOnly, Secure, SameSite cookie set by the
 * server so that client-side JavaScript (and therefore XSS) cannot read them.
 * The web-ide is a standalone Vite SPA whose auth endpoints (`/web-ide/auth/*`)
 * are proxied to an external ribix backend. The web-ide itself has no
 * server-side component that can set httpOnly cookies (its only server is the
 * collaboration WebSocket server), so a full httpOnly-cookie migration requires
 * the ribix backend to set the cookie on login/register and to read it for
 * validation instead of the `Authorization` header.
 *
 * CURRENT STRATEGY (fallback per C3 constraints)
 * ----------------------------------------------
 * Until the backend sets httpOnly cookies, the token is stored in
 * `sessionStorage` instead of `localStorage`. This reduces persistence: the
 * token is cleared when the browser tab closes and is scoped to a single tab,
 * so it is not shared across tabs and does not survive a browser restart. This
 * is a mitigation, not a complete fix — XSS can still read sessionStorage.
 *
 * All API calls also send `credentials: 'include'` so that, once the ribix
 * backend sets an httpOnly auth cookie, the cookie is transmitted
 * automatically and the `Authorization` header fallback can be removed.
 *
 * NON-SENSITIVE UI STATE
 * ----------------------
 * The `isAuthenticated` flag and the user/workspace objects (no token) remain
 * in `localStorage` so the UI can restore the logged-in state across reloads
 * without exposing the token itself.
 */

const TOKEN_KEY = 'ribix_token';

/**
 * Read the current JWT from sessionStorage. Returns null when no token is
 * stored (e.g. logged out, or first load in a new tab).
 */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    // sessionStorage may be unavailable (private browsing, disabled storage).
    return null;
  }
}

/**
 * Persist the JWT to sessionStorage. Intended to be called only right after a
 * successful login/register when the server returns a token in the response
 * body. Once the backend sets an httpOnly cookie this call becomes a no-op.
 */
export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage full or unavailable — non-fatal; cookie auth may still work.
  }
}

/**
 * Remove the JWT from sessionStorage (logout / session invalidation).
 */
export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Build the headers for an authenticated API request.
 *
 * Includes the `Authorization: Bearer <token>` header when a token is present
 * in sessionStorage. This is a backwards-compatible fallback so auth keeps
 * working against a backend that has not yet migrated to httpOnly cookies.
 * Once the backend reads the token exclusively from the cookie, callers can
 * stop adding this header and rely solely on `credentials: 'include'`.
 */
export function authHeader(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Standard fetch options that enable cookie transmission. Spread into every
 * authenticated request so httpOnly auth cookies are sent cross-origin once
 * the backend sets them. Requires the backend to respond with the appropriate
 * `Access-Control-Allow-Credentials` header.
 */
export const withCredentials: RequestInit = { credentials: 'include' };
