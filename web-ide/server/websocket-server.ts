/**
 * WebSocket Server for Real-time Collaboration
 * Uses y-websocket for CRDT synchronization
 */

import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection } from 'y-websocket/bin/utils';
import { pathToFileURL } from 'node:url';

export interface WebSocketServerConfig {
  port: number;
  host?: string;
  path?: string;
}

export class CollaborationWebSocketServer {
  private wss: WebSocketServer;
  private docs: Map<string, Y.Doc> = new Map();

  constructor(config: WebSocketServerConfig) {
    this.wss = new WebSocketServer({
      port: config.port,
      host: config.host || '0.0.0.0',
      path: config.path || '/collaboration',
    });

    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
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
      const userColor = url.searchParams.get('userColor') || '#4ECDC4';

      // Setup Yjs WebSocket connection
      setupWSConnection(ws, req, {
        gc: true,
        doc,
      });

      console.log(`User ${userName} (${userId}) connected to file ${fileId}`);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
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
  }
}

/**
 * Standalone WebSocket server entry point
 */
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const port = parseInt(process.env.WS_PORT || '1234', 10);
  const server = new CollaborationWebSocketServer({ port });
  
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
