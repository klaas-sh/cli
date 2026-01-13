'use client'

import React, { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'

/**
 * Props for the Terminal component.
 */
interface TerminalProps {
  /** The session ID to connect to */
  sessionId: string
  /** Callback when the terminal disconnects */
  onDisconnect?: () => void
}

/**
 * Terminal component that displays a read-only view of the Claude Code session.
 * Uses xterm.js for terminal rendering and WebSocket for real-time updates.
 */
export function Terminal({
  sessionId,
  onDisconnect
}: TerminalProps): React.JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termInstanceRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    // Prevent double initialization in strict mode
    if (initialized.current) return
    initialized.current = true

    let handleResize: (() => void) | null = null

    // Dynamic import xterm to avoid SSR issues
    async function initTerminal(): Promise<void> {
      if (!terminalRef.current) return

      const { Terminal } = await import('@xterm/xterm')
      const { FitAddon } = await import('@xterm/addon-fit')
      const { WebLinksAddon } = await import('@xterm/addon-web-links')

      const term = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1a1a1a',
          foreground: '#e0e0e0',
          cursor: '#e0e0e0',
        },
      })
      termInstanceRef.current = term

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())

      term.open(terminalRef.current)
      fitAddon.fit()

      // Show connecting message
      term.writeln('\x1b[1;34mConnecting to session...\x1b[0m')
      term.writeln('')

      // Handle WebSocket connection
      const wsUrl = `${process.env.NEXT_PUBLIC_API_URL
        ?.replace('http://', 'ws://')
        .replace('https://', 'wss://')}/ws/sessions/${sessionId}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = (): void => {
        term.writeln('\x1b[1;32mConnected.\x1b[0m')
        term.writeln('')
      }

      ws.onmessage = (event): void => {
        term.write(event.data)
      }

      ws.onerror = (): void => {
        term.writeln('\x1b[1;31mConnection error.\x1b[0m')
      }

      ws.onclose = (): void => {
        term.writeln('')
        term.writeln('\x1b[1;33mDisconnected.\x1b[0m')
        onDisconnect?.()
      }

      // Handle window resize
      handleResize = (): void => {
        fitAddon.fit()
      }
      window.addEventListener('resize', handleResize)
    }

    initTerminal()

    // Cleanup function
    return (): void => {
      if (handleResize) {
        window.removeEventListener('resize', handleResize)
      }
      wsRef.current?.close()
      termInstanceRef.current?.dispose()
    }
  }, [sessionId, onDisconnect])

  return (
    <div
      ref={terminalRef}
      className="h-[500px] p-4"
      style={{ backgroundColor: '#1a1a1a' }}
    />
  )
}
