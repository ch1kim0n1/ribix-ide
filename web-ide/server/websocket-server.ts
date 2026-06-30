/**
 * WebSocket Server for Real-time Collaboration
 * Uses y-websocket for CRDT synchronization
 */

import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

export interface WebSocketServerConfig {
  port: number;
  host?: string;
  path?: string;
  /** Shared secret token required on all connections. Set WS_AUTH_TOKEN in production. */
  authToken?: string;
}

export class CollaborationWebSocketServer {
  private wss: WebSocketServer;
  private docs: Map<string, Y.Doc> = new Map();
  private healthServer: http.Server | undefined;
  /** When set, every connection must supply a matching token query param. */
  private readonly authToken: string | undefined;

  /**
   * #137: Per-IP connection rate limiting. Tracks the number of open WebSocket
   * connections from each remote IP address. New connections are rejected with
   * close code 4429 when the per-IP ceiling is reached, preventing brute-force
   * enumeration of document IDs and resource exhaustion.
   */
  private static readonly MAX_CONNECTIONS_PER_IP = 10;
  private readonly connectionCountByIp = new Map<string, number>();

  constructor(config: WebSocketServerConfig) {
    this.authToken = config.authToken;
    this.wss = new WebSocketServer({
      port: config.port,
      host: config.host || '0.0.0.0',
      path: config.path || '/collaboration',
    });

    this.setupServer();
    this.setupHealthServer(config.port, config.host || '0.0.0.0');
  }

  private setupServer(): void {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // #137: Token-based auth — reject connections without a valid token when
      // WS_AUTH_TOKEN is configured. Clients must pass ?token=<value> in the URL.
      if (this.authToken) {
        const provided = url.searchParams.get('token');
        if (!provided || provided !== this.authToken) {
          ws.close(4401, 'Unauthorized: missing or invalid token');
          return;
        }
      }

      // #137: Per-IP rate limiting — reject if this IP already has too many open connections.
      const clientIp = req.socket.remoteAddress ?? 'unknown';
      const currentCount = this.connectionCountByIp.get(clientIp) ?? 0;
      if (currentCount >= CollaborationWebSocketServer.MAX_CONNECTIONS_PER_IP) {
        ws.close(4429, 'Too Many Connections: per-IP connection limit reached');
        return;
      }
      this.connectionCountByIp.set(clientIp, currentCount + 1);
      ws.on('close', () => {
        const n = this.connectionCountByIp.get(clientIp) ?? 1;
        if (n <= 1) {
          this.connectionCountByIp.delete(clientIp);
        } else {
          this.connectionCountByIp.set(clientIp, n - 1);
        }
      });

      const fileId = url.pathname.split('/').pop() || 'default';

      // Get or create document for this file
      let doc = this.docs.get(fileId);
      if (!doc) {
        doc = new Y.Doc();
        this.docs.set(fileId, doc);
      }

      // Extract user info from query params
      const userId = url.searchParams.get('userId') || 'anonymous';
      const userName = url.searchParams.get('userName') || 'Anonymous';

      // Setup Yjs WebSocket connection
      setupWSConnection(ws, req, {
        gc: true,
        doc,
      });

      console.debug(`User ${userName} (${userId}) connected to file ${fileId}`);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * Starts a minimal HTTP health server on port+1 so K8s HTTP probes and
   * docker-compose healthchecks can verify the websocket pod is alive
   * without upgrading to a WebSocket connection (issue #30).
   */
  private setupHealthServer(wsPort: number, host: string): void {
    const healthPort = wsPort + 1;
    this.healthServer = http.createServer((_req, res) => {
      if (_req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'ribix-ide-websocket',
          wsPort,
          docs: this.docs.size,
          timestamp: Date.now(),
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    this.healthServer.listen(healthPort, host);
    console.log(`Health server running on port ${healthPort}`);
  }

  /**
   * Get document for a file
   */
  getDocument(fileId: string): Y.Doc | undefined {
    return this.docs.get(fileId);
  }

  /**
   * Get all documents
   */
  getAllDocuments(): Map<string, Y.Doc> {
    return this.docs;
  }

  /**
   * Close the server
   */
  close(): void {
    this.docs.forEach((doc) => doc.destroy());
    this.docs.clear();
    this.wss.close();
    this.healthServer?.close();
  }
}

/**
 * Standalone WebSocket server entry point
 */
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = parseInt(process.env.WS_PORT || '1234', 10);
  // #137: Load auth token from env. Set WS_AUTH_TOKEN in production secrets.
  const authToken = process.env.WS_AUTH_TOKEN || undefined;
  if (!authToken) {
    console.warn('[websocket-server] WS_AUTH_TOKEN is not set — connections are not authenticated. Set WS_AUTH_TOKEN in production.');
  }
  const server = new CollaborationWebSocketServer({ port, authToken });

  console.log(`Collaboration WebSocket server running on port ${port}`);
  
  process.on('SIGTERM', () => {
    console.log('Shutting down WebSocket server...');
    server.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Shutting down WebSocket server...');
    server.close();
    process.exit(0);
  });
}
