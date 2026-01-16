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
  CliToServerMessageE2EE,
  EncryptedContent,
  ServerToCliMessage,
  ServerToCliMessageE2EE,
  ServerToWebMessage,
  ServerToWebMessageE2EE,
  WebToServerMessage,
  WebToServerMessageE2EE,
} from '../types';

/**
 * Combined CLI-to-server message type supporting both plaintext and E2EE.
 */
type CliMessage = CliToServerMessage | CliToServerMessageE2EE;

/**
 * Combined web-to-server message type supporting both plaintext and E2EE.
 */
type WebMessage = WebToServerMessage | WebToServerMessageE2EE;

/**
 * Combined server-to-CLI message type supporting both plaintext and E2EE.
 */
type ServerCliMessage = ServerToCliMessage | ServerToCliMessageE2EE;

/**
 * Combined server-to-web message type supporting both plaintext and E2EE.
 */
type ServerWebMessage = ServerToWebMessage | ServerToWebMessageE2EE;

/** Maximum messages to queue when CLI is disconnected */
const MAX_QUEUE_SIZE = 100;

/** Maximum age of queued messages in milliseconds (5 minutes) */
const MAX_QUEUE_AGE_MS = 5 * 60 * 1000;

/** Heartbeat interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Connection timeout in milliseconds (90 seconds without pong) */
const CONNECTION_TIMEOUT_MS = 90_000;

/**
 * Maximum size of the output buffer in bytes (256KB).
 * This provides scroll-back for web clients connecting mid-session.
 * Buffer is kept in memory and lost when the DO hibernates.
 */
const OUTPUT_BUFFER_MAX_BYTES = 256 * 1024;

interface QueuedMessage {
  message: ServerCliMessage;
  timestamp: number;
}

/**
 * Buffered output message for replay to new web clients.
 * Supports both plaintext (legacy) and encrypted (E2EE) formats.
 * Server is zero-knowledge - passes through without decryption.
 */
interface BufferedOutput {
  /** Base64-encoded terminal output (legacy plaintext format) */
  data?: string;
  /** Encrypted terminal output (E2EE format) */
  encrypted?: EncryptedContent;
  /** Timestamp of the output */
  timestamp: string;
  /** Approximate size in bytes for buffer management */
  size: number;
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

  /** Last pong received from CLI (timestamp for health monitoring) */
  private cliLastPong: number = 0;

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

  /**
   * Ring buffer of recent terminal output for replay to new web clients.
   * Keeps approximately OUTPUT_BUFFER_MAX_BYTES of recent output.
   */
  private outputBuffer: BufferedOutput[] = [];

  /** Current total size of output buffer in bytes */
  private outputBufferSize: number = 0;

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

    // Get session_id from URL - this is how we know which session this DO manages
    const sessionIdFromUrl = url.searchParams.get('session_id');
    if (sessionIdFromUrl && !this.sessionId) {
      // Initialize sessionId from URL if not already set
      // This ensures we have a sessionId even before CLI sends session_attach
      this.sessionId = sessionIdFromUrl;
    }

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
   * Reconstruct socket references from persistent WebSocket storage.
   * Called after hibernation to restore instance state.
   */
  private reconstructSocketRefs(): void {
    // Get all CLI sockets (should be at most one)
    const cliSockets = this.state.getWebSockets('cli');
    if (cliSockets.length > 0 && this.cliSocket !== cliSockets[0]) {
      console.log(
        `[SessionHub] Reconstructing CLI socket ref from storage for ` +
        `session ${this.sessionId}`
      );
      this.cliSocket = cliSockets[0];
      this.cliLastPong = Date.now();
    }

    // Get all web client sockets
    const webClientSockets = this.state.getWebSockets('web');
    for (const ws of webClientSockets) {
      if (!this.webSockets.has(ws)) {
        this.webSockets.add(ws);
        this.webLastPong.set(ws, Date.now());
      }
    }
  }

  /**
   * Check if CLI is connected using hibernation-aware API.
   * Reconstructs socket refs if needed.
   */
  private isCliConnected(): boolean {
    // First check instance variable (fast path)
    if (this.cliSocket) {
      return true;
    }

    // Instance var is null - might be after hibernation
    // Check persistent WebSocket storage
    const cliSockets = this.state.getWebSockets('cli');
    if (cliSockets.length > 0) {
      // Reconstruct the reference
      this.cliSocket = cliSockets[0];
      this.cliLastPong = Date.now();
      console.log(
        `[SessionHub] Reconstructed CLI socket from getWebSockets for ` +
        `session ${this.sessionId}`
      );
      return true;
    }

    return false;
  }

  /**
   * Handle CLI WebSocket connection.
   */
  private handleCliConnect(socket: WebSocket): void {
    // Only allow one CLI connection per session
    if (this.cliSocket) {
      console.log(`[SessionHub] Replacing existing CLI connection for session ${this.sessionId}`);
      this.cliSocket.close(4000, 'Replaced by new connection');
    }

    this.cliSocket = socket;
    this.cliLastPong = Date.now();

    console.log(`[SessionHub] CLI connected for session ${this.sessionId}`);

    // Immediately notify web clients that CLI is now attached
    // This ensures status is correct even before session_attach message
    if (this.sessionId) {
      this.broadcastToWeb({
        type: 'session_status',
        session_id: this.sessionId,
        status: 'attached',
      });
    }

    // Drain queued messages
    this.drainMessageQueue();
  }

  /**
   * Handle web client WebSocket connection.
   */
  private handleWebConnect(socket: WebSocket): void {
    this.webSockets.add(socket);
    this.webLastPong.set(socket, Date.now());

    // Use hibernation-aware check for CLI status
    const cliConnected = this.isCliConnected();
    const cliStatus = cliConnected ? 'attached' : 'detached';
    console.log(
      `[SessionHub] Web client connected for session ${this.sessionId}, ` +
      `CLI status: ${cliStatus}, buffer size: ${this.outputBuffer.length}`
    );

    // Send current session status to new client
    if (this.sessionId) {
      const statusMsg: ServerToWebMessage = {
        type: 'session_status',
        session_id: this.sessionId,
        status: cliStatus,
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
              status: cliStatus,
              started_at: new Date().toISOString(),
              attached_at: cliConnected ? new Date().toISOString() : null,
              cwd: this.cwd,
            },
          ],
        };
        socket.send(JSON.stringify(sessionsUpdate));
      }

      // Send buffered output history so client can see recent terminal content
      this.sendBufferedOutput(socket);
    } else {
      console.log('[SessionHub] No sessionId set, cannot send status to web client');
    }
  }

  /**
   * Handle incoming WebSocket messages.
   * This is called after hibernation wake-up, so we must reconstruct socket refs.
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

    // After hibernation, instance variables are lost. Reconstruct socket refs.
    // This ensures we track sockets correctly even after DO wakes from sleep.
    if (clientType === 'cli') {
      if (this.cliSocket !== ws) {
        console.log(
          `[SessionHub] Restoring CLI socket reference for session ` +
          `${this.sessionId} (was ${this.cliSocket ? 'different' : 'null'})`
        );
        this.cliSocket = ws;
        this.cliLastPong = Date.now();
      }
    } else {
      if (!this.webSockets.has(ws)) {
        console.log(
          `[SessionHub] Restoring web socket reference for session ` +
          `${this.sessionId}, total: ${this.webSockets.size + 1}`
        );
        this.webSockets.add(ws);
        this.webLastPong.set(ws, Date.now());
      }
    }

    try {
      const parsed = JSON.parse(msgStr) as Record<string, unknown>;

      // Handle pong messages from both client types
      if (parsed.type === 'pong') {
        if (clientType === 'cli') {
          this.cliLastPong = Date.now();
        } else {
          this.webLastPong.set(ws, Date.now());
        }
        return;
      }

      if (clientType === 'cli') {
        await this.handleCliMessage(parsed as CliMessage);
      } else {
        await this.handleWebMessage(parsed as WebMessage, ws);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      // Send error to web clients
      if (clientType === 'web') {
        this.sendErrorToWeb(ws, 'parse_error', 'Failed to parse message');
      }
    }
  }

  /**
   * Handle CLI messages.
   *
   * Message types:
   * - session_attach: CLI attaching to session with metadata
   * - output: Terminal output (plaintext or E2EE encrypted)
   * - session_detach: CLI detaching from session
   * - pong: Heartbeat response
   *
   * For E2EE: Server is zero-knowledge, passes encrypted content through
   * without decryption.
   */
  private async handleCliMessage(msg: CliMessage): Promise<void> {
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

      case 'output': {
        // Handle both encrypted (E2EE) and plaintext (legacy) output formats.
        // Server is zero-knowledge - passes through without decryption.
        const hasEncrypted = 'encrypted' in msg && msg.encrypted !== undefined;
        const hasData = 'data' in msg && msg.data !== undefined;

        if (hasEncrypted) {
          // E2EE format: buffer and forward encrypted content as-is
          this.bufferOutputEncrypted(msg.encrypted, msg.timestamp);
          this.broadcastToWeb({
            type: 'output',
            session_id: msg.session_id,
            encrypted: msg.encrypted,
            timestamp: msg.timestamp,
          });
        } else if (hasData) {
          // Legacy plaintext format: buffer and forward data
          this.bufferOutput(msg.data, msg.timestamp);
          this.broadcastToWeb({
            type: 'output',
            session_id: msg.session_id,
            data: msg.data,
            timestamp: msg.timestamp,
          });
        }
        break;
      }

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
        // Update last pong timestamp for connection health monitoring
        this.cliLastPong = Date.now();
        break;
    }
  }

  /**
   * Handle web client messages.
   *
   * Message types:
   * - subscribe: Subscribe to session updates (array of session_ids)
   * - prompt: Send text prompt to CLI (plaintext or E2EE encrypted)
   * - resize: Send terminal resize to CLI
   *
   * For E2EE: Server is zero-knowledge, passes encrypted content through
   * without decryption.
   */
  private async handleWebMessage(
    msg: WebMessage,
    ws: WebSocket
  ): Promise<void> {
    switch (msg.type) {
      case 'subscribe': {
        // Web clients connect to specific session DO via session_id
        // The subscribe message confirms the subscription and can request
        // initial state. Send current status for all requested sessions.
        if (this.sessionId && msg.session_ids.includes(this.sessionId)) {
          // Use hibernation-aware check for CLI status
          const cliConnected = this.isCliConnected();
          const cliStatus = cliConnected ? 'attached' : 'detached';

          const statusMsg: ServerToWebMessage = {
            type: 'session_status',
            session_id: this.sessionId,
            status: cliStatus,
          };
          ws.send(JSON.stringify(statusMsg));

          // Send session metadata if available
          if (this.deviceName && this.cwd) {
            const sessionsUpdate: ServerToWebMessage = {
              type: 'sessions_update',
              sessions: [
                {
                  session_id: this.sessionId,
                  device_id: this.deviceId || '',
                  device_name: this.deviceName,
                  status: cliStatus,
                  started_at: new Date().toISOString(),
                  attached_at: cliConnected ? new Date().toISOString() : null,
                  cwd: this.cwd,
                },
              ],
            };
            ws.send(JSON.stringify(sessionsUpdate));
          }
        }
        break;
      }

      case 'prompt': {
        // Verify session ID matches
        if (msg.session_id !== this.sessionId) {
          this.sendErrorToWeb(ws, 'session_mismatch', 'Session ID mismatch');
          return;
        }

        // Handle both encrypted (E2EE) and plaintext (legacy) prompt formats.
        // Server is zero-knowledge - passes through without decryption.
        const hasEncrypted = 'encrypted' in msg && msg.encrypted !== undefined;
        const hasText = 'text' in msg && msg.text !== undefined;

        if (hasEncrypted) {
          // E2EE format: forward encrypted content as-is
          this.sendToCli({
            type: 'prompt',
            session_id: msg.session_id,
            encrypted: msg.encrypted,
            source: 'web',
            timestamp: new Date().toISOString(),
          });
        } else if (hasText) {
          // Legacy plaintext format: forward text
          this.sendToCli({
            type: 'prompt',
            session_id: msg.session_id,
            text: msg.text,
            source: 'web',
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'resize':
        // Verify session ID matches
        if (msg.session_id !== this.sessionId) {
          this.sendErrorToWeb(ws, 'session_mismatch', 'Session ID mismatch');
          return;
        }

        // Forward resize to CLI (will be queued if disconnected)
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

      // Update stored status
      const currentMetadata =
        await this.state.storage.get<SessionMetadata>('metadata');
      if (currentMetadata) {
        currentMetadata.status = 'detached';
        await this.state.storage.put('metadata', currentMetadata);
      }

      // Notify web clients that CLI disconnected
      if (this.sessionId) {
        this.broadcastToWeb({
          type: 'session_status',
          session_id: this.sessionId,
          status: 'detached',
        });
      }
    } else {
      // Clean up web client
      this.webSockets.delete(ws);
      this.webLastPong.delete(ws);
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
   * Uses hibernation-aware check to find CLI socket.
   * Supports both plaintext and E2EE message formats.
   */
  private sendToCli(msg: ServerCliMessage): void {
    // Use hibernation-aware check to get CLI socket
    if (this.isCliConnected() && this.cliSocket) {
      try {
        this.cliSocket.send(JSON.stringify(msg));
        console.log(
          `[SessionHub] Sent ${msg.type} message to CLI for session ` +
          `${this.sessionId}`
        );
      } catch (error) {
        console.error(
          `[SessionHub] Failed to send to CLI, queueing message:`,
          error
        );
        this.queueMessage(msg);
      }
    } else {
      // Queue message for when CLI reconnects
      console.log(
        `[SessionHub] CLI not connected, queueing ${msg.type} message ` +
        `for session ${this.sessionId}`
      );
      this.queueMessage(msg);
    }
  }

  /**
   * Broadcast message to all connected web clients.
   * Uses getWebSockets to ensure we reach all clients after hibernation.
   * Supports both plaintext and E2EE message formats.
   */
  private broadcastToWeb(msg: ServerWebMessage): void {
    const msgStr = JSON.stringify(msg);

    // Get all web sockets from persistent storage (hibernation-aware)
    const webClientSockets = this.state.getWebSockets('web');
    for (const ws of webClientSockets) {
      try {
        ws.send(msgStr);
      } catch (error) {
        console.error(
          `[SessionHub] Failed to broadcast to web client:`,
          error
        );
        // Clean up failed socket from tracking
        this.webSockets.delete(ws);
        this.webLastPong.delete(ws);
      }
    }
  }

  /**
   * Send error message to a specific web client.
   */
  private sendErrorToWeb(ws: WebSocket, code: string, message: string): void {
    const errorMsg: ServerToWebMessage = {
      type: 'error',
      code,
      message,
    };
    try {
      ws.send(JSON.stringify(errorMsg));
    } catch (error) {
      console.error('[SessionHub] Failed to send error to web client:', error);
    }
  }

  /**
   * Buffer plaintext terminal output for replay to web clients.
   * Maintains a ring buffer of approximately OUTPUT_BUFFER_MAX_BYTES.
   */
  private bufferOutput(data: string, timestamp: string): void {
    const size = data.length;

    // Add new output to buffer
    this.outputBuffer.push({ data, timestamp, size });
    this.outputBufferSize += size;

    this.logBufferStatus();
    this.trimBufferIfNeeded();
  }

  /**
   * Buffer encrypted terminal output for replay to web clients.
   * Server is zero-knowledge - stores encrypted content without decryption.
   * Maintains a ring buffer of approximately OUTPUT_BUFFER_MAX_BYTES.
   */
  private bufferOutputEncrypted(
    encrypted: EncryptedContent,
    timestamp: string
  ): void {
    // Estimate size based on ciphertext length (main payload)
    const size = encrypted.ciphertext.length + encrypted.nonce.length +
      encrypted.tag.length;

    // Add new output to buffer
    this.outputBuffer.push({ encrypted, timestamp, size });
    this.outputBufferSize += size;

    this.logBufferStatus();
    this.trimBufferIfNeeded();
  }

  /**
   * Log buffer status occasionally to avoid spam.
   */
  private logBufferStatus(): void {
    if (this.outputBuffer.length % 10 === 1) {
      console.log(
        `[SessionHub] Buffered output: ${this.outputBuffer.length} messages, ` +
        `${this.outputBufferSize} bytes total`
      );
    }
  }

  /**
   * Trim buffer if it exceeds max size.
   */
  private trimBufferIfNeeded(): void {
    while (
      this.outputBufferSize > OUTPUT_BUFFER_MAX_BYTES &&
      this.outputBuffer.length > 1
    ) {
      const removed = this.outputBuffer.shift();
      if (removed) {
        this.outputBufferSize -= removed.size;
      }
    }
  }

  /**
   * Send all buffered output to a specific web client.
   * Called when a new web client connects to provide scroll-back history.
   * Supports both plaintext and E2EE formats - sends in original format.
   */
  private sendBufferedOutput(socket: WebSocket): void {
    console.log(
      `[SessionHub] sendBufferedOutput: sessionId=${this.sessionId}, ` +
      `readyState=${socket.readyState}, bufferLength=${this.outputBuffer.length}, ` +
      `bufferSize=${this.outputBufferSize} bytes`
    );

    if (!this.sessionId) {
      console.log('[SessionHub] Skipping buffer send: no sessionId');
      return;
    }

    if (this.outputBuffer.length === 0) {
      console.log('[SessionHub] Skipping buffer send: buffer is empty');
      return;
    }

    // Note: In CF Workers DO, socket should be ready after acceptWebSocket
    // readyState check removed as it may not be accurate in DO context

    console.log(
      `[SessionHub] Sending ${this.outputBuffer.length} buffered messages ` +
      `(${this.outputBufferSize} bytes)`
    );

    // Send each buffered output message in its original format
    for (const { data, encrypted, timestamp } of this.outputBuffer) {
      let msg: ServerWebMessage;

      if (encrypted) {
        // E2EE format: send encrypted content as-is
        msg = {
          type: 'output',
          session_id: this.sessionId,
          encrypted,
          timestamp,
        };
      } else if (data) {
        // Legacy plaintext format
        msg = {
          type: 'output',
          session_id: this.sessionId,
          data,
          timestamp,
        };
      } else {
        // Should not happen, but skip malformed entries
        continue;
      }

      socket.send(JSON.stringify(msg));
    }
  }

  /**
   * Queue a message for later delivery to CLI.
   * Supports both plaintext and E2EE message formats.
   */
  private queueMessage(msg: ServerCliMessage): void {
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
   * Uses hibernation-aware check for CLI socket.
   */
  private drainMessageQueue(): void {
    // Use hibernation-aware check
    if (!this.isCliConnected() || !this.cliSocket) {
      return;
    }

    const now = Date.now();
    let sentCount = 0;

    for (const { message, timestamp } of this.messageQueue) {
      // Skip expired messages
      if (now - timestamp > MAX_QUEUE_AGE_MS) {
        continue;
      }

      try {
        this.cliSocket.send(JSON.stringify(message));
        sentCount++;
      } catch (error) {
        console.error(
          '[SessionHub] Failed to send queued message to CLI:',
          error
        );
        break; // Stop trying if send fails
      }
    }

    if (sentCount > 0) {
      console.log(
        `[SessionHub] Drained ${sentCount} queued messages to CLI ` +
        `for session ${this.sessionId}`
      );
    }

    this.messageQueue = [];
  }

  /**
   * Alarm handler for periodic tasks (heartbeat, cleanup).
   * Reconstructs socket refs after hibernation wake-up.
   */
  async alarm(): Promise<void> {
    const now = Date.now();

    // Reconstruct socket references after potential hibernation
    this.reconstructSocketRefs();

    // Check CLI connection health using hibernation-aware check
    if (this.isCliConnected() && this.cliSocket) {
      // Check if CLI has timed out
      if (
        this.cliLastPong > 0 &&
        now - this.cliLastPong > CONNECTION_TIMEOUT_MS
      ) {
        // CLI connection timed out
        console.log(
          `[SessionHub] CLI timed out for session ${this.sessionId}, ` +
          `last pong: ${now - this.cliLastPong}ms ago`
        );
        this.cliSocket.close(4001, 'Connection timeout');
        this.cliSocket = null;

        // Notify web clients of disconnection
        if (this.sessionId) {
          this.broadcastToWeb({
            type: 'session_status',
            session_id: this.sessionId,
            status: 'detached',
          });
        }
      } else {
        // Send ping to CLI
        try {
          this.cliSocket.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error(
            `[SessionHub] Failed to ping CLI for session ${this.sessionId}:`,
            error
          );
        }
      }
    }

    // Reconstruct web socket refs and send pings
    const webClientSockets = this.state.getWebSockets('web');
    for (const ws of webClientSockets) {
      // Ensure socket is in our tracking set
      if (!this.webSockets.has(ws)) {
        this.webSockets.add(ws);
        this.webLastPong.set(ws, Date.now());
      }

      const lastPong = this.webLastPong.get(ws) ?? now;

      // Check if web client has timed out
      if (lastPong > 0 && now - lastPong > CONNECTION_TIMEOUT_MS) {
        // Web client connection timed out
        console.log(
          `[SessionHub] Web client timed out for session ${this.sessionId}`
        );
        ws.close(4001, 'Connection timeout');
        this.webSockets.delete(ws);
        this.webLastPong.delete(ws);
      } else {
        // Send ping to web client
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error(
            `[SessionHub] Failed to ping web client for session ` +
            `${this.sessionId}:`,
            error
          );
        }
      }
    }

    // Schedule next alarm
    await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
  }
}
