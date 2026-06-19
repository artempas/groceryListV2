'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ListEvent, ListItemDTO } from '@/lib/list-events'
import { sortItems } from '@/lib/sort-items'

// The browser reconnects on its own while readyState is CONNECTING. These bound
// the manual reconnect we do after a fatal close (readyState CLOSED).
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

/**
 * Subscribes to server-sent item events for a list and keeps the
 * ['items', listId] React Query cache in sync. Returns a per-tab clientId
 * that callers must send as the `x-client-id` header on their mutations, so
 * the server skips echoing those events back to this tab.
 */
export function useListEvents(listId: string): string {
  const qc = useQueryClient()
  const clientIdRef = useRef<string>()
  if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID()
  const clientId = clientIdRef.current

  useEffect(() => {
    const key = ['items', listId]
    const url = `/api/lists/${listId}/events?clientId=${clientId}`

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const connect = () => {
      es = new EventSource(url)

      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as ListEvent

        if (event.type === 'item.deleted') {
          qc.setQueryData<ListItemDTO[]>(key, (old = []) =>
            old.filter((it) => it.id !== event.payload.id),
          )
          return
        }

        if (event.type === 'item.added') {
          qc.setQueryData<ListItemDTO[]>(key, (old = []) => {
            if (old.some((it) => it.id === event.payload.id)) return old
            return sortItems([...old, event.payload])
          })
          return
        }

        if (event.type === 'item.updated') {
          qc.setQueryData<ListItemDTO[]>(key, (old = []) =>
            sortItems(old.map((it) => (it.id === event.payload.id ? event.payload : it))),
          )
        }
      }

      es.onopen = () => {
        attempt = 0 // a successful connect resets the backoff
        // Resync after (re)connect to close any gap of events missed while disconnected.
        qc.invalidateQueries({ queryKey: ['items', listId] })
      }

      es.onerror = () => {
        // While readyState is CONNECTING the browser is already auto-reconnecting;
        // only step in once it has given up (CLOSED) and reconnect with capped backoff.
        if (!es || es.readyState !== EventSource.CLOSED || stopped || reconnectTimer !== undefined) {
          return
        }
        es.close()
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
        attempt += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined
          connect()
        }, delay)
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [listId, clientId, qc])

  return clientId
}
