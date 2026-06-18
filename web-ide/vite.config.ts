import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

const marketplaceHealthPlugin = (): PluginOption => ({
  name: 'ribix-marketplace-health',
  configureServer(server) {
    server.middlewares.use('/web-ide/marketplace/health', (_req, res) => {
      res.statusCode = 204;
      res.end();
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_DEV_BACKEND_TARGET;
  const collaborationTarget = env.VITE_DEV_COLLABORATION_TARGET;

  return {
    plugins: [react(), marketplaceHealthPlugin()],
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
