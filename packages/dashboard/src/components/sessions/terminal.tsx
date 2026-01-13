'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

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
  data: string
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
  text: string
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
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const reconnectAttemptRef = useRef<number>(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [sessionStatus, setSessionStatus] =
    useState<'attached' | 'detached' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /**
   * Decodes base64 data to string for terminal output.
   */
  const decodeBase64 = useCallback((data: string): string => {
    try {
      return atob(data)
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
   * Connects to the WebSocket server.
   */
  const connect = useCallback((): void => {
    const term = xtermRef.current
    if (!term) return

    const wsUrl = buildWebSocketUrl()
    if (!wsUrl) {
      setConnectionState('error')
      setErrorMessage('No authentication token found')
      term.writeln('\x1b[31mError: No authentication token found\x1b[0m')
      return
    }

    setConnectionState('connecting')
    setErrorMessage(null)

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = (): void => {
      reconnectAttemptRef.current = 0
      setConnectionState('connected')
      term.writeln('\x1b[32mConnected to session\x1b[0m')
      term.writeln('')

      // Subscribe to the session
      sendMessage({
        type: 'subscribe',
        session_ids: [sessionId]
      })

      // Send initial resize
      sendMessage({
        type: 'resize',
        session_id: sessionId,
        cols: term.cols,
        rows: term.rows
      })
    }

    ws.onmessage = (event): void => {
      try {
        const message = JSON.parse(event.data as string) as ServerToWebMessage

        switch (message.type) {
          case 'output':
            // Decode base64 data and write to terminal
            if (message.session_id === sessionId) {
              const decoded = decodeBase64(message.data)
              term.write(decoded)
            }
            break

          case 'session_status':
            // Handle session status changes
            if (message.session_id === sessionId) {
              setSessionStatus(message.status)
              onSessionStatus?.(message.status)

              if (message.status === 'attached') {
                term.writeln('\x1b[32mCLI attached\x1b[0m')
              } else if (message.status === 'detached') {
                term.writeln('\x1b[33mCLI detached\x1b[0m')
              }
            }
            break

          case 'error':
            // Display error message
            setErrorMessage(message.message)
            term.writeln(`\x1b[31mError: ${message.message}\x1b[0m`)
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
      setConnectionState('disconnected')
      term.writeln('')
      term.writeln('\x1b[31mDisconnected from session\x1b[0m')

      // Check if we should attempt to reconnect
      if (event.code !== 1000 && event.code !== 4000) {
        // Abnormal closure, attempt reconnect
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptRef.current++
          const msg = `Reconnecting in ${RECONNECT_DELAY_MS / 1000}s ` +
            `(attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})`
          term.writeln(`\x1b[33m${msg}...\x1b[0m`)

          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, RECONNECT_DELAY_MS)
        } else {
          term.writeln('\x1b[31mMax reconnection attempts reached\x1b[0m')
        }
      }

      onDisconnect?.()
    }

    ws.onerror = (): void => {
      setConnectionState('error')
      term.writeln('\x1b[31mConnection error\x1b[0m')
    }
  }, [
    buildWebSocketUrl,
    decodeBase64,
    onDisconnect,
    onSessionStatus,
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

  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize xterm.js
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#f0f0f0',
        cursor: '#f0f0f0',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Display initial connecting message
    term.writeln('\x1b[33mConnecting...\x1b[0m')

    // Connect to WebSocket
    connect()

    // Handle terminal input - send as prompt message
    const inputDisposable = term.onData((data) => {
      sendMessage({
        type: 'prompt',
        session_id: sessionId,
        text: data
      })
    })

    // Handle resize
    const handleResize = (): void => {
      fitAddon.fit()
      sendMessage({
        type: 'resize',
        session_id: sessionId,
        cols: term.cols,
        rows: term.rows
      })
    }

    window.addEventListener('resize', handleResize)

    // Cleanup on unmount
    return (): void => {
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
        wsRef.current.close(1000, 'Component unmounting')
        wsRef.current = null
      }

      // Dispose terminal
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [connect, sendMessage, sessionId])

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
            {connectionState === 'connecting' && 'Connecting...'}
            {connectionState === 'connected' && 'Connected'}
            {connectionState === 'disconnected' && 'Disconnected'}
            {connectionState === 'error' && (errorMessage || 'Error')}
          </span>

          {/* Session status */}
          {sessionStatus && connectionState === 'connected' && (
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
      <div
        ref={terminalRef}
        className="flex-1 min-h-0"
      />
    </div>
  )
}
