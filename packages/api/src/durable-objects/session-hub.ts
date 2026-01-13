/**
 * SessionHub Durable Object - WebSocket hub for a single session.
 *
 * Each session gets its own Durable Object instance that manages:
 * - CLI WebSocket connection
 * - Web client WebSocket connections (multiple viewers)
 * - Message routing between CLI and web clients
 * - Offline message queuing
 */

import type {
  CliToServerMessage,
  ServerToCliMessage,
  WebToServerMessage,
  ServerToWebMessage,
} from '../types';

/** Maximum messages to queue when CLI is disconnected */
const MAX_QUEUE_SIZE = 100;

/** Maximum age of queued messages in milliseconds (5 minutes) */
const MAX_QUEUE_AGE_MS = 5 * 60 * 1000;

interface QueuedMessage {
  message: ServerToCliMessage;
  timestamp: number;
}

/**
 * SessionHub Durable Object for managing WebSocket connections.
 */
export class SessionHub implements DurableObject {
  /** Durable Object state */
  private state: DurableObjectState;

  /** CLI WebSocket connection (only one) */
  private cliSocket: WebSocket | null = null;

  /** Web client WebSocket connections (multiple viewers) */
  private webSockets: Set<WebSocket> = new Set();

  /** Message queue for when CLI is disconnected */
  private messageQueue: QueuedMessage[] = [];

  /** Session metadata */
  private sessionId: string | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<{
        sessionId: string;
        deviceId: string;
        deviceName: string;
        cwd: string;
      }>('metadata');

      if (stored) {
        this.sessionId = stored.sessionId;
      }
    });
  }

  /**
   * Handle incoming HTTP requests (WebSocket upgrades).
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Determine if this is a CLI or web client connection
    const clientType = url.searchParams.get('client') || 'cli';

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    this.state.acceptWebSocket(server, [clientType]);

    if (clientType === 'cli') {
      this.handleCliConnect(server);
    } else {
      this.handleWebConnect(server);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle CLI WebSocket connection.
   */
  private handleCliConnect(socket: WebSocket): void {
    // Only allow one CLI connection per session
    if (this.cliSocket) {
      this.cliSocket.close(4000, 'Replaced by new connection');
    }

    this.cliSocket = socket;

    // Drain queued messages
    this.drainMessageQueue();
  }

  /**
   * Handle web client WebSocket connection.
   */
  private handleWebConnect(socket: WebSocket): void {
    this.webSockets.add(socket);

    // Send current session status to new client
    if (this.sessionId) {
      const statusMsg: ServerToWebMessage = {
        type: 'session_status',
        session_id: this.sessionId,
        status: this.cliSocket ? 'attached' : 'detached',
      };
      socket.send(JSON.stringify(statusMsg));
    }
  }

  /**
   * Handle incoming WebSocket messages.
   */
  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const tags = this.state.getTags(ws);
    const clientType = tags[0] || 'cli';
    const msgStr =
      typeof message === 'string'
        ? message
        : new TextDecoder().decode(message);

    try {
      if (clientType === 'cli') {
        await this.handleCliMessage(JSON.parse(msgStr) as CliToServerMessage);
      } else {
        await this.handleWebMessage(JSON.parse(msgStr) as WebToServerMessage);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Handle CLI messages.
   */
  private async handleCliMessage(msg: CliToServerMessage): Promise<void> {
    switch (msg.type) {
      case 'session_attach':
        // Store session metadata
        this.sessionId = msg.session_id;

        await this.state.storage.put('metadata', {
          sessionId: msg.session_id,
          deviceId: msg.device_id,
          deviceName: msg.device_name,
          cwd: msg.cwd,
        });

        // Notify web clients
        this.broadcastToWeb({
          type: 'session_status',
          session_id: msg.session_id,
          status: 'attached',
        });
        break;

      case 'output':
        // Forward terminal output to all web clients
        this.broadcastToWeb({
          type: 'output',
          session_id: msg.session_id,
          data: msg.data,
          timestamp: msg.timestamp,
        });
        break;

      case 'session_detach':
        // Notify web clients
        this.broadcastToWeb({
          type: 'session_status',
          session_id: msg.session_id,
          status: 'detached',
        });
        break;

      case 'pong':
        // Heartbeat response, nothing to do
        break;
    }
  }

  /**
   * Handle web client messages.
   */
  private async handleWebMessage(msg: WebToServerMessage): Promise<void> {
    switch (msg.type) {
      case 'subscribe':
        // Web clients can subscribe to multiple sessions
        // For now, we just acknowledge (session routing is handled by DO naming)
        break;

      case 'prompt':
        // Forward prompt to CLI
        this.sendToCli({
          type: 'prompt',
          session_id: msg.session_id,
          text: msg.text,
          source: 'web',
          timestamp: new Date().toISOString(),
        });
        break;

      case 'resize':
        // Forward resize to CLI
        this.sendToCli({
          type: 'resize',
          session_id: msg.session_id,
          cols: msg.cols,
          rows: msg.rows,
        });
        break;
    }
  }

  /**
   * Handle WebSocket close.
   */
  async webSocketClose(ws: WebSocket): Promise<void> {
    const tags = this.state.getTags(ws);
    const clientType = tags[0] || 'cli';

    if (clientType === 'cli' && this.cliSocket === ws) {
      this.cliSocket = null;

      // Notify web clients that CLI disconnected
      if (this.sessionId) {
        this.broadcastToWeb({
          type: 'session_status',
          session_id: this.sessionId,
          status: 'detached',
        });
      }
    } else {
      this.webSockets.delete(ws);
    }
  }

  /**
   * Handle WebSocket error.
   */
  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
  }

  /**
   * Send message to CLI, or queue if disconnected.
   */
  private sendToCli(msg: ServerToCliMessage): void {
    if (this.cliSocket && this.cliSocket.readyState === WebSocket.OPEN) {
      this.cliSocket.send(JSON.stringify(msg));
    } else {
      // Queue message for when CLI reconnects
      this.queueMessage(msg);
    }
  }

  /**
   * Broadcast message to all connected web clients.
   */
  private broadcastToWeb(msg: ServerToWebMessage): void {
    const msgStr = JSON.stringify(msg);
    for (const ws of this.webSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msgStr);
      }
    }
  }

  /**
   * Queue a message for later delivery to CLI.
   */
  private queueMessage(msg: ServerToCliMessage): void {
    // Prune old messages
    const now = Date.now();
    this.messageQueue = this.messageQueue.filter(
      (m) => now - m.timestamp < MAX_QUEUE_AGE_MS
    );

    // Add new message
    this.messageQueue.push({ message: msg, timestamp: now });

    // Trim queue if too large
    if (this.messageQueue.length > MAX_QUEUE_SIZE) {
      this.messageQueue = this.messageQueue.slice(-MAX_QUEUE_SIZE);
    }
  }

  /**
   * Send all queued messages to CLI.
   */
  private drainMessageQueue(): void {
    if (!this.cliSocket || this.cliSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const now = Date.now();
    for (const { message, timestamp } of this.messageQueue) {
      // Skip expired messages
      if (now - timestamp > MAX_QUEUE_AGE_MS) {
        continue;
      }
      this.cliSocket.send(JSON.stringify(message));
    }

    this.messageQueue = [];
  }

  /**
   * Alarm handler for periodic tasks (heartbeat, cleanup).
   */
  async alarm(): Promise<void> {
    // Send ping to CLI
    if (this.cliSocket && this.cliSocket.readyState === WebSocket.OPEN) {
      this.cliSocket.send(JSON.stringify({ type: 'ping' }));
    }

    // Schedule next alarm (30 seconds)
    await this.state.storage.setAlarm(Date.now() + 30_000);
  }
}
