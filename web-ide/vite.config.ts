import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Health check plugin (issue #30).
 *
 * Adds a /health endpoint to both the dev server (configureServer) and the
 * preview server (configurePreviewServer) so K8s liveness/readiness probes
 * get a 200 instead of a 404. The endpoint returns a minimal JSON body with
 * the service name and timestamp.
 */
const healthPlugin = (): PluginOption => ({
  name: 'ribix-health-endpoint',
  configureServer(server) {
    server.middlewares.use('/health', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok', service: 'ribix-ide-web', timestamp: Date.now() }));
    });
    server.middlewares.use('/web-ide/marketplace/health', (_req, res) => {
      res.statusCode = 204;
      res.end();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/health', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok', service: 'ribix-ide-web', timestamp: Date.now() }));
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_DEV_BACKEND_TARGET;
  const collaborationTarget = env.VITE_DEV_COLLABORATION_TARGET;

  return {
    plugins: [react(), healthPlugin()],
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/web-ide/marketplace/query': {
          target: 'https://marketplace.visualstudio.com',
          changeOrigin: true,
          rewrite: () => '/_apis/public/gallery/extensionquery',
          headers: {
            Accept: 'application/json;api-version=7.2-preview.1',
            'User-Agent': 'ribix-ide/dev',
          },
        },
        ...(backendTarget ? {
          '/api': {
            target: backendTarget,
            changeOrigin: true,
          },
          '/web-ide': {
            target: backendTarget,
            changeOrigin: true,
          },
        } : {}),
        ...(collaborationTarget ? {
          '/collaboration': {
            target: collaborationTarget,
            changeOrigin: true,
            ws: true,
          },
        } : {}),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Incremental build (issue #59): use manifest + chunk splitting
      // so unchanged chunks are cached by the browser via content-hash filenames.
      manifest: true,
      rollupOptions: {
        output: {
          // Split vendor chunks for better caching
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'monaco-vendor': ['monaco-editor', '@monaco-editor/react'],
            'collaboration-vendor': ['yjs', 'y-websocket', 'y-protocols'],
          },
        },
      },
      // Use Vite's cache directory for incremental rebuilds
      cacheDir: 'node_modules/.vite',
    },
    // Enable esbuild cache for faster incremental rebuilds
    esbuild: {
      legalComments: 'none',
    },
  };
});
