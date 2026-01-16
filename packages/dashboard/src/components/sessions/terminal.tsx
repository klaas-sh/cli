'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  useEncryption,
  type EncryptedContent,
} from '../../hooks/use-encryption'

/** Token key for localStorage */
const TOKEN_KEY = 'user-token'

/** Reconnection delay in milliseconds */
const RECONNECT_DELAY_MS = 3000

/** Maximum reconnection attempts */
const MAX_RECONNECT_ATTEMPTS = 5

/** Connection state for the terminal */
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * WebSocket message types from server to web client.
 * Matches ServerToWebMessage from the API types.
 */
interface OutputMessage {
  type: 'output'
  session_id: string
  /** Plaintext data (base64 encoded) - used when E2EE is disabled */
  data?: string
  /** Encrypted data - used when E2EE is enabled */
  encrypted?: EncryptedContent
  timestamp: string
}

interface SessionStatusMessage {
  type: 'session_status'
  session_id: string
  status: 'attached' | 'detached'
}

interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

interface SessionsUpdateMessage {
  type: 'sessions_update'
  sessions: unknown[]
}

type ServerToWebMessage =
  | OutputMessage
  | SessionStatusMessage
  | ErrorMessage
  | SessionsUpdateMessage

/**
 * WebSocket message types from web client to server.
 * Matches WebToServerMessage from the API types.
 */
interface SubscribeMessage {
  type: 'subscribe'
  session_ids: string[]
}

interface PromptMessage {
  type: 'prompt'
  session_id: string
  /** Plaintext text - used when E2EE is disabled */
  text?: string
  /** Encrypted text - used when E2EE is enabled */
  encrypted?: EncryptedContent
}

interface ResizeMessage {
  type: 'resize'
  session_id: string
  cols: number
  rows: number
}

type WebToServerMessage = SubscribeMessage | PromptMessage | ResizeMessage

interface TerminalProps {
  sessionId: string
  onDisconnect?: () => void
  onSessionStatus?: (status: 'attached' | 'detached') => void
}

/**
 * Terminal component that connects to a session via WebSocket.
 * Uses xterm.js for terminal rendering.
 *
 * Connects to the SessionHub Durable Object and handles:
 * - Real-time terminal output streaming
 * - User input forwarding
 * - Terminal resize events
 * - Connection state management with auto-reconnect
 */
export function Terminal({
  sessionId,
  onDisconnect,
  onSessionStatus
}: TerminalProps): React.JSX.Element {
  // Dynamic imports for xterm (avoid SSR issues)
  const [xtermModules, setXtermModules] = useState<{
    Terminal: typeof import('@xterm/xterm').Terminal
    FitAddon: typeof import('@xterm/addon-fit').FitAddon
    WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon
  } | null>(null)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null)
  const reconnectAttemptRef = useRef<number>(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef<boolean>(true)

  // Store callbacks in refs to avoid triggering reconnections when they change
  // This prevents the useEffect from re-running when parent re-renders with
  // new inline callback functions
  const onDisconnectRef = useRef(onDisconnect)
  const onSessionStatusRef = useRef(onSessionStatus)

  // Update refs when callbacks change (without triggering reconnection)
  useEffect(() => {
    onDisconnectRef.current = onDisconnect
    onSessionStatusRef.current = onSessionStatus
  }, [onDisconnect, onSessionStatus])

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [sessionStatus, setSessionStatus] =
    useState<'attached' | 'detached' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reconnectAttempt, setReconnectAttempt] = useState(0)

  // Encryption state
  const {
    isEnabled: encryptionEnabled,
    isUnlocked: encryptionUnlocked,
    isLoading: encryptionLoading,
    error: encryptionError,
    initialize: initializeEncryption,
    unlock: unlockEncryption,
    encryptForSession,
    decryptForSession,
  } = useEncryption()

  // Local state for unlock password input
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)
  // Decryption error for display in terminal
  const [decryptionError, setDecryptionError] = useState<string | null>(null)

  // Initialize encryption state on mount
  useEffect(() => {
    initializeEncryption()
  }, [initializeEncryption])

  // Load xterm modules on mount (client-side only)
  useEffect(() => {
    let cancelled = false
    const loadModules = async (): Promise<void> => {
      try {
        const [xtermModule, fitModule, linksModule] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links')
        ])
        if (!cancelled) {
          setXtermModules({
            Terminal: xtermModule.Terminal,
            FitAddon: fitModule.FitAddon,
            WebLinksAddon: linksModule.WebLinksAddon
          })
        }
      } catch {
        // xterm modules failed to load - user will see loading state
      }
    }
    loadModules()
    return (): void => { cancelled = true }
  }, [])

  /**
   * Decodes base64 data to string for terminal output.
   * Uses TextDecoder to properly handle UTF-8 encoded content.
   */
  const decodeBase64 = useCallback((data: string): string => {
    try {
      // Decode base64 to binary string
      const binaryString = atob(data)
      // Convert binary string to Uint8Array
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      // Decode UTF-8 bytes to string
      return new TextDecoder('utf-8').decode(bytes)
    } catch {
      // If decoding fails, return the raw data
      return data
    }
  }, [])

  /**
   * Builds the WebSocket URL with authentication.
   */
  const buildWebSocketUrl = useCallback((): string | null => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const token = localStorage.getItem(TOKEN_KEY)

    if (!token) {
      return null
    }

    // Build URL with session_id, client type, and token
    const url = new URL(wsUrl)
    url.searchParams.set('session_id', sessionId)
    url.searchParams.set('client', 'web')
    url.searchParams.set('token', token)

    return url.toString()
  }, [sessionId])

  /**
   * Sends a message to the WebSocket server.
   */
  const sendMessage = useCallback((message: WebToServerMessage): void => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }, [])

  /**
   * Handles encrypted output messages.
   * Decrypts content if encryption is unlocked, shows placeholder otherwise.
   */
  const handleEncryptedOutput = useCallback(
    async (
      encrypted: EncryptedContent,
      term: import('@xterm/xterm').Terminal
    ): Promise<void> => {
      if (!encryptionUnlocked) {
        // Encryption is locked - show placeholder
        term.write('\r\n[Encrypted - Enter password to view]\r\n')
        return
      }

      try {
        // Decrypt the content
        const decrypted = await decryptForSession(sessionId, encrypted)
        const text = new TextDecoder().decode(decrypted)
        term.write(text)
        // Clear any previous decryption error on success
        setDecryptionError(null)
      } catch (error) {
        // Decryption failed - show error message
        const errorMsg = error instanceof Error
          ? error.message
          : 'Decryption failed'
        setDecryptionError(errorMsg)
        term.write(`\r\n[Decryption error: ${errorMsg}]\r\n`)
      }
    },
    [encryptionUnlocked, decryptForSession, sessionId]
  )

  /**
   * Sends encrypted or plaintext prompt to the server.
   */
  const sendPrompt = useCallback(
    async (text: string): Promise<void> => {
      if (encryptionEnabled && encryptionUnlocked) {
        // E2EE is enabled and unlocked - encrypt the message
        try {
          const plaintext = new TextEncoder().encode(text)
          const encrypted = await encryptForSession(sessionId, plaintext)
          sendMessage({
            type: 'prompt',
            session_id: sessionId,
            encrypted,
          })
        } catch {
          // Encryption failed - fall back to plaintext
          sendMessage({
            type: 'prompt',
            session_id: sessionId,
            text,
          })
        }
      } else {
        // E2EE not enabled or locked - send plaintext
        sendMessage({
          type: 'prompt',
          session_id: sessionId,
          text,
        })
      }
    },
    [
      encryptionEnabled,
      encryptionUnlocked,
      encryptForSession,
      sendMessage,
      sessionId,
    ]
  )

  /**
   * Handles the unlock form submission.
   */
  const handleUnlock = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault()
      if (!unlockPassword) return

      setIsUnlocking(true)
      setUnlockError(null)

      const success = await unlockEncryption(unlockPassword)
      if (!success) {
        setUnlockError('Invalid password')
      }
      setUnlockPassword('')
      setIsUnlocking(false)
    },
    [unlockPassword, unlockEncryption]
  )

  /**
   * Connects to the WebSocket server.
   */
  const connect = useCallback((): void => {
    // Don't connect if component is unmounted (React Strict Mode cleanup)
    if (!isMountedRef.current) return

    const term = xtermRef.current
    if (!term) return

    const wsUrl = buildWebSocketUrl()
    if (!wsUrl) {
      setConnectionState('error')
      setErrorMessage('No authentication token found')
      return
    }

    setConnectionState('connecting')
    setErrorMessage(null)

    // Close existing connection if any
    if (wsRef.current) {
      try {
        // Use code 4000 to indicate intentional replacement
        wsRef.current.close(4000, 'Replaced by new connection')
      } catch {
        // Ignore close errors on already closed WebSocket
      }
      wsRef.current = null
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = (): void => {
      // Check if still mounted before updating state
      if (!isMountedRef.current) {
        ws.close(1000, 'Component unmounted')
        return
      }

      reconnectAttemptRef.current = 0
      setReconnectAttempt(0)
      setConnectionState('connected')

      // Subscribe to the session
      sendMessage({
        type: 'subscribe',
        session_ids: [sessionId]
      })

      // Send initial resize (only if terminal has valid dimensions)
      if (term.cols > 0 && term.rows > 0) {
        sendMessage({
          type: 'resize',
          session_id: sessionId,
          cols: term.cols,
          rows: term.rows
        })
      }
    }

    ws.onmessage = (event): void => {
      // Check if still mounted
      if (!isMountedRef.current) return

      try {
        const message = JSON.parse(event.data as string) as ServerToWebMessage

        switch (message.type) {
          case 'output':
            if (message.session_id === sessionId) {
              // Handle encrypted or plaintext output
              if (message.encrypted) {
                // Encrypted message - need to decrypt
                handleEncryptedOutput(message.encrypted, term)
              } else if (message.data) {
                // Plaintext message - decode base64 and display
                const decoded = decodeBase64(message.data)
                term.write(decoded)
              }
            }
            break

          case 'session_status':
            // Handle session status changes (only update state, don't write
            // to terminal - status is shown in the status bar)
            if (message.session_id === sessionId) {
              setSessionStatus(message.status)
              onSessionStatusRef.current?.(message.status)
            }
            break

          case 'error':
            // Update error state (shown in status bar, not terminal)
            setErrorMessage(message.message)
            break

          case 'sessions_update':
            // Sessions list update, not relevant for single terminal view
            break
        }
      } catch {
        // Silently ignore malformed messages
      }
    }

    ws.onclose = (event): void => {
      // Check if still mounted
      if (!isMountedRef.current) return

      // Check if we should attempt to reconnect
      if (event.code !== 1000 && event.code !== 4000) {
        // Abnormal closure, attempt reconnect
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptRef.current++
          setReconnectAttempt(reconnectAttemptRef.current)
          setConnectionState('connecting')
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, RECONNECT_DELAY_MS)
          // Don't call onDisconnect during reconnection attempts
          return
        } else {
          setConnectionState('disconnected')
          // Only notify of disconnect when we've exhausted reconnection attempts
          onDisconnectRef.current?.()
        }
      } else {
        // Clean closure (code 1000 or 4000)
        setConnectionState('disconnected')
        onDisconnectRef.current?.()
      }
    }

    ws.onerror = (): void => {
      if (!isMountedRef.current) return
      setConnectionState('error')
    }
  }, [
    buildWebSocketUrl,
    decodeBase64,
    handleEncryptedOutput,
    sendMessage,
    sessionId
  ])
  // Note: onDisconnect and onSessionStatus are accessed via refs to prevent
  // reconnections when parent re-renders with new inline callbacks

  /**
   * Handles manual reconnection.
   */
  const handleReconnect = useCallback((): void => {
    reconnectAttemptRef.current = 0
    connect()
  }, [connect])

  // Initialize terminal once xterm modules are loaded
  useEffect(() => {
    if (!xtermModules || !terminalRef.current) return

    // Mark as mounted (for React Strict Mode)
    isMountedRef.current = true

    const { Terminal: XTerm, FitAddon, WebLinksAddon } = xtermModules

    // Initialize xterm.js
    // Hide xterm cursor since Claude Code renders its own cursor
    const term = new XTerm({
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 10000,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#f0f0f0',
        // Make cursor transparent (same as background) to hide it
        cursor: 'transparent',
        cursorAccent: 'transparent',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)

    // Delay fit to ensure container has dimensions
    requestAnimationFrame(() => {
      if (isMountedRef.current) {
        fitAddon.fit()
      }
    })

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Connect to WebSocket after terminal is ready
    // Use setTimeout to allow React Strict Mode's mount/unmount cycle to complete
    // This prevents "WebSocket is closed before the connection is established" errors
    const connectTimeout = setTimeout(() => {
      if (isMountedRef.current) {
        connect()
        // Focus terminal for keyboard input
        term.focus()
      }
    }, 50) // Small delay to survive Strict Mode double-mount

    // Store timeout for cleanup
    const connectTimeoutRef = connectTimeout

    // Handle terminal input - send as prompt message (encrypted if enabled)
    const inputDisposable = term.onData((data) => {
      sendPrompt(data)
    })

    // Handle resize with error handling for disposed terminals
    const handleResize = (): void => {
      if (!isMountedRef.current) return

      try {
        fitAddon.fit()
        // Only send resize if terminal has valid dimensions
        if (term.cols > 0 && term.rows > 0) {
          sendMessage({
            type: 'resize',
            session_id: sessionId,
            cols: term.cols,
            rows: term.rows
          })
        }
      } catch {
        // Terminal may have been disposed, ignore resize errors
      }
    }

    window.addEventListener('resize', handleResize)

    // Cleanup on unmount
    return (): void => {
      // Mark as unmounted first to prevent race conditions
      isMountedRef.current = false

      // Clear connect timeout if pending (for Strict Mode)
      clearTimeout(connectTimeoutRef)

      // Clear reconnect timeout if pending
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      // Remove event listeners
      window.removeEventListener('resize', handleResize)
      inputDisposable.dispose()

      // Close WebSocket connection - use try/catch to handle edge cases
      if (wsRef.current) {
        try {
          // Use code 1000 for clean shutdown
          wsRef.current.close(1000, 'Component unmounting')
        } catch {
          // WebSocket may already be closed or in invalid state
        }
        wsRef.current = null
      }

      // Dispose terminal with error handling
      try {
        term.dispose()
      } catch {
        // Terminal may already be disposed
      }
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [xtermModules, connect, sendMessage, sendPrompt, sessionId])

  /**
   * Get connection status text for status bar.
   */
  const getConnectionText = (): string => {
    if (connectionState === 'connecting') {
      if (reconnectAttempt > 0) {
        return `Reconnecting (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})...`
      }
      return 'Connecting...'
    }
    if (connectionState === 'connected') return 'Connected'
    if (connectionState === 'disconnected') return 'Disconnected'
    if (connectionState === 'error') return errorMessage || 'Error'
    return ''
  }

  // Show loading state while xterm modules are loading
  if (!xtermModules) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800
          border-b border-zinc-700 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full
              bg-yellow-500 animate-pulse" />
            <span className="text-zinc-400">Loading terminal...</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-[#1a1a1a] flex items-center
          justify-center">
          <div className="animate-spin h-6 w-6 border-2 border-zinc-600
            border-t-zinc-400 rounded-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Connection status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800
        border-b border-zinc-700 text-xs">
        <div className="flex items-center gap-2">
          {/* Connection state indicator */}
          <span className={`inline-block w-2 h-2 rounded-full ${
            connectionState === 'connected'
              ? 'bg-green-500'
              : connectionState === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-red-500'
          }`} />
          <span className="text-zinc-400">
            {getConnectionText()}
          </span>

          {/* Session/CLI status - show whenever we have it */}
          {sessionStatus && (
            <>
              <span className="text-zinc-600">|</span>
              <span className={`${
                sessionStatus === 'attached'
                  ? 'text-green-400'
                  : 'text-yellow-400'
              }`}>
                CLI {sessionStatus}
              </span>
            </>
          )}

          {/* E2EE status indicator */}
          {encryptionEnabled && (
            <>
              <span className="text-zinc-600">|</span>
              <span className={`${
                encryptionUnlocked
                  ? 'text-green-400'
                  : 'text-yellow-400'
              }`}>
                {encryptionUnlocked ? 'E2EE Unlocked' : 'E2EE Locked'}
              </span>
            </>
          )}

          {/* Decryption error indicator */}
          {decryptionError && (
            <>
              <span className="text-zinc-600">|</span>
              <span className="text-red-400">
                Decryption Error
              </span>
            </>
          )}
        </div>

        {/* Reconnect button */}
        {connectionState === 'disconnected' && (
          <button
            onClick={handleReconnect}
            className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600
              rounded text-zinc-300 transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Terminal container with optional unlock overlay */}
      <div className="flex-1 min-h-0 relative">
        {/* Terminal */}
        <div
          ref={terminalRef}
          className="h-full cursor-text"
          onClick={() => xtermRef.current?.focus()}
        />

        {/* Unlock encryption overlay */}
        {encryptionEnabled && !encryptionUnlocked && !encryptionLoading && (
          <div className="absolute inset-0 bg-zinc-900/90 flex items-center
            justify-center">
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg
              p-6 max-w-sm w-full mx-4">
              <div className="text-center mb-4">
                <div className="inline-flex items-center justify-center w-12
                  h-12 rounded-full bg-yellow-500/20 mb-3">
                  <svg
                    className="w-6 h-6 text-yellow-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2
                        2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-zinc-100">
                  Session Encrypted
                </h3>
                <p className="text-sm text-zinc-400 mt-1">
                  Enter your encryption password to view session content
                </p>
              </div>

              <form onSubmit={handleUnlock} className="space-y-4">
                <div>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    placeholder="Encryption password"
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700
                      rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none
                      focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    autoFocus
                    disabled={isUnlocking}
                  />
                </div>

                {(unlockError || encryptionError) && (
                  <p className="text-sm text-red-400 text-center">
                    {unlockError || encryptionError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isUnlocking || !unlockPassword}
                  className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-700
                    disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg
                    text-white font-medium transition-colors"
                >
                  {isUnlocking ? 'Unlocking...' : 'Unlock'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
