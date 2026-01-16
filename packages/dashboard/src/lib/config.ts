/**
 * Configuration utilities for the dashboard
 */

/**
 * Gets the API base URL.
 * Checks NEXT_PUBLIC_DEV_API_PORT first (for dev-ports auto-discovery),
 * then falls back to NEXT_PUBLIC_API_URL, then localhost:8787.
 */
export function getApiUrl(): string {
  // Check for dev-ports auto-discovery first
  if (process.env.NEXT_PUBLIC_DEV_API_PORT) {
    return `http://localhost:${process.env.NEXT_PUBLIC_DEV_API_PORT}`
  }
  // Fall back to explicit API URL or default
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
}

/**
 * Gets the WebSocket URL derived from the API URL.
 */
export function getWsUrl(): string {
  return getApiUrl().replace(/^http/, 'ws')
}
