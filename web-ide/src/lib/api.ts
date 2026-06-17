const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '');

const joinBase = (base: string, path = '') => {
  const normalizedBase = trimTrailingSlash(base) || '';
  const normalizedPath = trimLeadingSlash(path);
  if (!normalizedPath) {
    return normalizedBase || '/';
  }
  if (!normalizedBase || normalizedBase === '/') {
    return `/${normalizedPath}`;
  }
  return `${normalizedBase}/${normalizedPath}`;
};

const env = import.meta.env as Record<string, string | undefined>;

const apiBase = env.VITE_API_BASE_URL || '/api';
const webIdeApiBase = env.VITE_WEB_IDE_API_BASE_URL || '/web-ide';

export const apiUrl = (path = '') => joinBase(apiBase, path);
export const webIdeApiUrl = (path = '') => joinBase(webIdeApiBase, path);

export const collaborationWebSocketUrl = (path = 'collaboration') => {
  const explicit = env.VITE_COLLABORATION_WS_URL;
  if (explicit) {
    return explicit;
  }
  if (typeof window === 'undefined') {
    return `ws://localhost:1234/${trimLeadingSlash(path)}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/${trimLeadingSlash(path)}`;
};
