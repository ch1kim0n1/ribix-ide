// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// import.meta.env is provided by Vite's vitest integration.
import { apiUrl, webIdeApiUrl, collaborationWebSocketUrl } from './api';

describe('apiUrl', () => {
  it('joins base and path', () => {
    expect(apiUrl('/foo')).toBe('/api/foo');
  });

  it('returns base when no path', () => {
    expect(apiUrl()).toBe('/api');
  });

  it('trims trailing slash from base', () => {
    expect(apiUrl('bar')).toBe('/api/bar');
  });
});

describe('webIdeApiUrl', () => {
  it('joins base and path', () => {
    expect(webIdeApiUrl('/auth/login')).toBe('/web-ide/auth/login');
  });

  it('returns base when no path', () => {
    expect(webIdeApiUrl()).toBe('/web-ide');
  });
});

describe('collaborationWebSocketUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_COLLABORATION_WS_URL', '');
  });

  it('uses explicit env when set', () => {
    vi.stubEnv('VITE_COLLABORATION_WS_URL', 'wss://custom.example.com/ws');
    expect(collaborationWebSocketUrl()).toBe('wss://custom.example.com/ws');
  });

  it('derives from window.location when no env', () => {
    vi.stubEnv('VITE_COLLABORATION_WS_URL', '');
    // jsdom defaults to http://localhost:3000
    const url = collaborationWebSocketUrl();
    expect(url).toMatch(/^ws:\/\/localhost/);
    expect(url).toContain('/collaboration');
  });
});
