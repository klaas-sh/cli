'use client'

import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  onDisconnect?: () => void
}

/**
 * Terminal component that connects to a session via WebSocket.
 * Uses xterm.js for terminal rendering.
 */
export function Terminal({
  sessionId,
  onDisconnect
}: TerminalProps): React.JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

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

    // Connect to WebSocket
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const token = localStorage.getItem('user-token')

    const ws = new WebSocket(
      `${wsUrl}/dashboard/sessions/${sessionId}/terminal?token=${token}`
    )

    ws.onopen = (): void => {
      term.writeln('\x1b[32mConnected to session\x1b[0m')
      term.writeln('')
    }

    ws.onmessage = (event): void => {
      const data = JSON.parse(event.data)
      if (data.type === 'output') {
        term.write(data.content)
      } else if (data.type === 'clear') {
        term.clear()
      }
    }

    ws.onclose = (): void => {
      term.writeln('')
      term.writeln('\x1b[31mDisconnected from session\x1b[0m')
      onDisconnect?.()
    }

    ws.onerror = (): void => {
      term.writeln('\x1b[31mConnection error\x1b[0m')
    }

    wsRef.current = ws

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', content: data }))
      }
    })

    // Handle resize
    const handleResize = (): void => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }))
      }
    }

    window.addEventListener('resize', handleResize)

    return (): void => {
      window.removeEventListener('resize', handleResize)
      ws.close()
      term.dispose()
    }
  }, [sessionId, onDisconnect])

  return (
    <div
      ref={terminalRef}
      className="h-[500px] w-full"
    />
  )
}
