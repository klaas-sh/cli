/**
 * Type definitions for Nexo API.
 *
 * All IDs use ULID format (26 characters, uppercase alphanumeric).
 */

/**
 * Cloudflare Workers environment bindings.
 */
export interface Env {
  /** D1 database binding */
  DB: D1Database;
  /** KV namespace for rate limiting */
  RATE_LIMIT_KV: KVNamespace;
  /** KV namespace for caching */
  CACHE_KV: KVNamespace;
  /** Durable Object for session hub */
  SESSION_HUB: DurableObjectNamespace;
  /** Environment name */
  ENVIRONMENT: 'development' | 'staging' | 'production';
  /** API version */
  API_VERSION: string;
  /** GitHub OAuth client ID */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth client secret */
  GITHUB_CLIENT_SECRET?: string;
  /** JWT signing secret */
  JWT_SECRET?: string;
  /** Dashboard URL (for device authorization flow) */
  DASHBOARD_URL?: string;
}

/**
 * User account in the database.
 */
export interface User {
  /** ULID user identifier */
  id: string;
  /** GitHub user ID */
  github_id: string;
  /** GitHub username */
  github_username: string;
  /** User email */
  email: string;
  /** Account creation timestamp (ISO 8601) */
  created_at: string;
}

/**
 * CLI device in the database.
 */
export interface Device {
  /** ULID device identifier */
  id: string;
  /** Owner user ID */
  user_id: string;
  /** Device name (hostname) */
  name: string;
  /** Ed25519 public key (base64) */
  public_key: string;
  /** Registration timestamp (ISO 8601) */
  created_at: string;
  /** Last activity timestamp (ISO 8601) */
  last_seen_at: string;
}

/**
 * CLI session in the database.
 */
export interface Session {
  /** ULID session identifier */
  id: string;
  /** Owner user ID */
  user_id: string;
  /** Device ID running the session */
  device_id: string;
  /** Session status */
  status: 'attached' | 'detached';
  /** Working directory of the CLI */
  cwd: string;
  /** Session start timestamp (ISO 8601) */
  started_at: string;
  /** Attach timestamp (ISO 8601, nullable) */
  attached_at: string | null;
  /** Detach timestamp (ISO 8601, nullable) */
  detached_at: string | null;
}

/**
 * Device code for OAuth Device Flow.
 */
export interface DeviceCode {
  /** Unique device code for polling */
  device_code: string;
  /** User-facing code to enter */
  user_code: string;
  /** URL where user enters the code */
  verification_uri: string;
  /** Expiration time in seconds */
  expires_in: number;
  /** Polling interval in seconds */
  interval: number;
}

/**
 * OAuth token response.
 */
export interface TokenResponse {
  /** JWT access token */
  access_token: string;
  /** Token type (always "Bearer") */
  token_type: 'Bearer';
  /** Expiration time in seconds */
  expires_in: number;
  /** Refresh token for renewal */
  refresh_token: string;
}

/**
 * Session list item returned by API.
 */
export interface SessionListItem {
  /** Session ID */
  session_id: string;
  /** Device ID */
  device_id: string;
  /** Device name */
  device_name: string;
  /** Connection status */
  status: 'attached' | 'detached';
  /** Session start time */
  started_at: string;
  /** Last attach time */
  attached_at: string | null;
  /** Working directory */
  cwd: string;
}

/**
 * WebSocket message types from CLI to server.
 */
export type CliToServerMessage =
  | { type: 'session_attach'; session_id: string; device_id: string; device_name: string; cwd: string }
  | { type: 'output'; session_id: string; data: string; timestamp: string }
  | { type: 'session_detach'; session_id: string }
  | { type: 'pong' };

/**
 * WebSocket message types from server to CLI.
 */
export type ServerToCliMessage =
  | { type: 'prompt'; session_id: string; text: string; source: string; timestamp: string }
  | { type: 'resize'; session_id: string; cols: number; rows: number }
  | { type: 'ping' };

/**
 * WebSocket message types from web client to server.
 */
export type WebToServerMessage =
  | { type: 'subscribe'; session_ids: string[] }
  | { type: 'prompt'; session_id: string; text: string }
  | { type: 'resize'; session_id: string; cols: number; rows: number };

/**
 * WebSocket message types from server to web client.
 */
export type ServerToWebMessage =
  | { type: 'sessions_update'; sessions: SessionListItem[] }
  | { type: 'output'; session_id: string; data: string; timestamp: string }
  | { type: 'session_status'; session_id: string; status: 'attached' | 'detached' }
  | { type: 'error'; code: string; message: string };

/**
 * JWT payload for access tokens.
 */
export interface JwtPayload {
  /** Subject (user ID) */
  sub: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
  /** Token type */
  type: 'access' | 'refresh';
}
