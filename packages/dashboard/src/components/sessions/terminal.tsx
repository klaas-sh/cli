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
 *
 * E2EE is fully automatic - encryption happens transparently.
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

  // Encryption state - auto-initializes, always unlocked
  const {
    isUnlocked: encryptionUnlocked,
    autoInitialize,
    encryptForSession,
    decryptForSession,
  } = useEncryption()

  // Decryption error for display in terminal
  const [decryptionError, setDecryptionError] = useState<string | null>(null)

  // Auto-initialize encryption on mount
  useEffect(() => {
    autoInitialize()
  }, [autoInitialize])

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
   * Decrypts content automatically.
   */
  const handleEncryptedOutput = useCallback(
    async (
      encrypted: EncryptedContent,
      term: import('@xterm/xterm').Terminal
    ): Promise<void> => {
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
    [decryptForSession, sessionId]
  )

  /**
   * Sends encrypted prompt to the server.
   * E2EE is always enabled, so all messages are encrypted.
   */
  const sendPrompt = useCallback(
    async (text: string): Promise<void> => {
      if (encryptionUnlocked) {
        // Encrypt the message
        try {
          const plaintext = new TextEncoder().encode(text)
          const encrypted = await encryptForSession(sessionId, plaintext)
          sendMessage({
            type: 'prompt',
            session_id: sessionId,
            encrypted,
          })
        } catch {
          // Encryption failed - fall back to plaintext (should not happen)
          sendMessage({
            type: 'prompt',
            session_id: sessionId,
            text,
          })
        }
      } else {
        // Encryption not ready yet - send plaintext as fallback
        sendMessage({
          type: 'prompt',
          session_id: sessionId,
          text,
        })
      }
    },
    [encryptionUnlocked, encryptForSession, sendMessage, sessionId]
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
                // Encrypted message - decrypt automatically
                handleEncryptedOutput(message.encrypted, term)
              } else if (message.data) {
                // Plaintext message - decode base64 and display
                const decoded = decodeBase64(message.data)
                term.write(decoded)
              }
            }
            break

          case 'session_status':
            // Handle session status changes
            if (message.session_id === sessionId) {
              setSessionStatus(message.status)
              onSessionStatusRef.current?.(message.status)
            }
            break

          case 'error':
            // Update error state (shown in status bar)
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
          // Notify of disconnect when reconnection attempts exhausted
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
    // Use setTimeout to allow React Strict Mode's mount/unmount to complete
    const connectTimeout = setTimeout(() => {
      if (isMountedRef.current) {
        connect()
        // Focus terminal for keyboard input
        term.focus()
      }
    }, 50) // Small delay to survive Strict Mode double-mount

    // Store timeout for cleanup
    const connectTimeoutRef = connectTimeout

    // Handle terminal input - send as encrypted prompt
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

      // Close WebSocket connection
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

          {/* Session/CLI status */}
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
          <span className="text-zinc-600">|</span>
          <span className={`${
            encryptionUnlocked ? 'text-green-400' : 'text-yellow-400'
          }`}>
            {encryptionUnlocked ? 'E2EE Active' : 'E2EE Initializing'}
          </span>

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

      {/* Terminal container */}
      <div className="flex-1 min-h-0">
        <div
          ref={terminalRef}
          className="h-full cursor-text"
          onClick={() => xtermRef.current?.focus()}
        />
      </div>
    </div>
  )
}
