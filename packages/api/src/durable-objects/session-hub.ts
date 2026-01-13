/**
 * SessionHub Durable Object - WebSocket hub for a single session.
 *
 * Each session gets its own Durable Object instance that manages:
 * - CLI WebSocket connection
 * - Web client WebSocket connections (multiple viewers)
 * - Message routing between CLI and web clients
 * - Offline message queuing
 * - Heartbeat ping/pong for connection health
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

/** Heartbeat interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL_MS = 30_000;

interface QueuedMessage {
  message: ServerToCliMessage;
  timestamp: number;
}

/** Session metadata stored in Durable Object storage */
interface SessionMetadata {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  cwd: string;
  status: 'attached' | 'detached';
}

/**
 * SessionHub Durable Object for managing WebSocket connections.
 *
 * Handles:
 * - CLI connections: session_attach, output, session_detach, pong
 * - Web connections: subscribe, prompt, resize, pong
 * - Message routing between CLI and web clients
 * - Connection health monitoring via heartbeat
 */
export class SessionHub implements DurableObject {
  /** Durable Object state */
  private state: DurableObjectState;

  /** CLI WebSocket connection (only one per session) */
  private cliSocket: WebSocket | null = null;

  /** Web client WebSocket connections (multiple viewers) */
  private webSockets: Set<WebSocket> = new Set();

  /** Map of web socket to last pong timestamp */
  private webLastPong: Map<WebSocket, number> = new Map();

  /** Message queue for when CLI is disconnected */
  private messageQueue: QueuedMessage[] = [];

  /** Session metadata */
  private sessionId: string | null = null;

  /** Device ID for this session */
  private deviceId: string | null = null;

  /** Device name for this session */
  private deviceName: string | null = null;

  /** Current working directory */
  private cwd: string | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<SessionMetadata>('metadata');

      if (stored) {
        this.sessionId = stored.sessionId;
        this.deviceId = stored.deviceId;
        this.deviceName = stored.deviceName;
        this.cwd = stored.cwd;
      }

      // Start heartbeat alarm if not already set
      const alarm = await this.state.storage.getAlarm();
      if (!alarm) {
        await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
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
    this.webLastPong.set(socket, Date.now());

    // Send current session status to new client
    if (this.sessionId) {
      const statusMsg: ServerToWebMessage = {
        type: 'session_status',
        session_id: this.sessionId,
        status: this.cliSocket ? 'attached' : 'detached',
      };
      socket.send(JSON.stringify(statusMsg));

      // If we have session metadata, send it
      if (this.deviceName && this.cwd) {
        const sessionsUpdate: ServerToWebMessage = {
          type: 'sessions_update',
          sessions: [
            {
              session_id: this.sessionId,
              device_id: this.deviceId || '',
              device_name: this.deviceName,
              status: this.cliSocket ? 'attached' : 'detached',
              started_at: new Date().toISOString(),
              attached_at: this.cliSocket ? new Date().toISOString() : null,
              cwd: this.cwd,
            },
          ],
        };
        socket.send(JSON.stringify(sessionsUpdate));
      }
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
   *
   * Message types:
   * - session_attach: CLI attaching to session with metadata
   * - output: Terminal output (base64 encoded)
   * - session_detach: CLI detaching from session
   * - pong: Heartbeat response
   */
  private async handleCliMessage(msg: CliToServerMessage): Promise<void> {
    switch (msg.type) {
      case 'session_attach': {
        // Store session metadata in memory
        this.sessionId = msg.session_id;
        this.deviceId = msg.device_id;
        this.deviceName = msg.device_name;
        this.cwd = msg.cwd;

        // Persist metadata to storage
        const metadata: SessionMetadata = {
          sessionId: msg.session_id,
          deviceId: msg.device_id,
          deviceName: msg.device_name,
          cwd: msg.cwd,
          status: 'attached',
        };
        await this.state.storage.put('metadata', metadata);

        // Notify all web clients of attachment
        this.broadcastToWeb({
          type: 'session_status',
          session_id: msg.session_id,
          status: 'attached',
        });

        // Send full session update to web clients
        this.broadcastToWeb({
          type: 'sessions_update',
          sessions: [
            {
              session_id: msg.session_id,
              device_id: msg.device_id,
              device_name: msg.device_name,
              status: 'attached',
              started_at: new Date().toISOString(),
              attached_at: new Date().toISOString(),
              cwd: msg.cwd,
            },
          ],
        });
        break;
      }

      case 'output':
        // Forward terminal output (base64 encoded) to all web clients
        this.broadcastToWeb({
          type: 'output',
          session_id: msg.session_id,
          data: msg.data,
          timestamp: msg.timestamp,
        });
        break;

      case 'session_detach': {
        // Update stored status
        const currentMetadata =
          await this.state.storage.get<SessionMetadata>('metadata');
        if (currentMetadata) {
          currentMetadata.status = 'detached';
          await this.state.storage.put('metadata', currentMetadata);
        }

        // Notify web clients
        this.broadcastToWeb({
          type: 'session_status',
          session_id: msg.session_id,
          status: 'detached',
        });
        break;
      }

      case 'pong':
        // Heartbeat response received, connection is healthy
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
