import { EventEmitter } from 'events'

export interface ListItemDTO {
  id: string
  name: string
  category: string | null
  listId: string
  // Prisma supplies Date; serializes to an ISO string over the SSE wire.
  createdAt: string | Date
  checkedAt: string | Date | null
  createdBy: { id: string; name: string }
  checkedBy: { id: string; name: string } | null
}

export type ListEvent =
  | { type: 'item.added'; listId: string; originClientId: string | null; payload: ListItemDTO }
  | { type: 'item.updated'; listId: string; originClientId: string | null; payload: ListItemDTO }
  | { type: 'item.deleted'; listId: string; originClientId: string | null; payload: { id: string } }

// Stored on globalThis so the single emitter instance survives Next.js dev HMR,
// the same pattern lib/prisma.ts uses for the Prisma client.
const globalForEvents = globalThis as unknown as { listEvents?: EventEmitter }

const emitter = globalForEvents.listEvents ?? new EventEmitter()
// Many concurrent SSE connections subscribe; disable the default 10-listener warning.
emitter.setMaxListeners(0)
globalForEvents.listEvents = emitter

function channel(listId: string): string {
  return `list:${listId}`
}

export function emitListEvent(listId: string, event: ListEvent): void {
  emitter.emit(channel(listId), event)
}

export function subscribeListEvents(
  listId: string,
  handler: (event: ListEvent) => void,
): () => void {
  const ch = channel(listId)
  emitter.on(ch, handler)
  return () => {
    emitter.off(ch, handler)
  }
}
