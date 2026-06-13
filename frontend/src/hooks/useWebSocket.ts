'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseWebSocketReturn {
  isConnected: boolean
  lastMessage: string | null
  sendMessage: (message: string) => void
  reconnect: () => void
}

const RECONNECT_DELAY_MS = 3000

export function useWebSocket(url: string): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldReconnectRef = useRef(true)
  const connectRef = useRef<() => void>(() => {})

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current || reconnectTimeoutRef.current) {
      return
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null
      connectRef.current()
    }, RECONNECT_DELAY_MS)
  }, [])

  const connect = useCallback(() => {
    if (!url) {
      return
    }

    const existingSocket = ws.current
    if (
      existingSocket
      && (existingSocket.readyState === WebSocket.OPEN
        || existingSocket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    try {
      const socket = new WebSocket(url)
      ws.current = socket

      socket.onopen = () => {
        if (ws.current !== socket) {
          return
        }

        clearReconnectTimer()
        setIsConnected(true)
      }

      socket.onmessage = (event) => {
        if (ws.current === socket && typeof event.data === 'string') {
          setLastMessage(event.data)
        }
      }

      socket.onclose = () => {
        if (ws.current === socket) {
          ws.current = null
          setIsConnected(false)
          scheduleReconnect()
        }
      }

      socket.onerror = () => {
        if (ws.current === socket) {
          setIsConnected(false)
        }
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      setIsConnected(false)
      scheduleReconnect()
    }
  }, [clearReconnectTimer, scheduleReconnect, url])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const sendMessage = useCallback((message: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(message)
    } else {
      console.warn('WebSocket is not connected')
    }
  }, [])

  const reconnect = useCallback(() => {
    clearReconnectTimer()

    if (ws.current) {
      const socket = ws.current
      ws.current = null
      socket.close()
    }

    setIsConnected(false)
    connectRef.current()
  }, [clearReconnectTimer])

  useEffect(() => {
    shouldReconnectRef.current = true
    connect()

    return () => {
      shouldReconnectRef.current = false
      clearReconnectTimer()

      if (ws.current) {
        const socket = ws.current
        ws.current = null
        socket.close()
      }
    }
  }, [clearReconnectTimer, connect])

  return {
    isConnected,
    lastMessage,
    sendMessage,
    reconnect,
  }
}
