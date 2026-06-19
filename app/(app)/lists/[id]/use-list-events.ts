'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ListEvent, ListItemDTO } from '@/lib/list-events'
import { sortItems } from '@/lib/sort-items'

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
    const es = new EventSource(`/api/lists/${listId}/events?clientId=${clientId}`)

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
      // Resync after (re)connect to close any gap of events missed while disconnected.
      qc.invalidateQueries({ queryKey: ['items', listId] })
    }

    return () => es.close()
  }, [listId, clientId, qc])

  return clientId
}
