# Real-time sync of list edits (SSE)

## Problem

When several people share a list (`ListMembership`), each person's browser only
refreshes item data on its own mutations or on window refocus — React Query is
configured with `staleTime: 60s` and no polling. If two people edit the same
list at the same time, neither sees the other's additions, check-offs, or
deletions until they manually reload or refocus the tab. The list feels static
and out of sync.

## Goal

Propagate item changes (add / check-uncheck / delete) made by one member to all
other members viewing the same list in real time, without changing how mutations
themselves work. Mutations stay on REST; we only need to *deliver* other people's
changes to everyone else's open page.

## Non-goals

- No change to the REST mutation flow or optimistic UI already in place.
- No live sync of membership changes (who joined/left) in v1 — the members panel
  already refetches when opened. Listed under "Possible extensions".
- No live sync of list-level changes (rename / delete) — out of scope per
  product decision; only `item` events, routed per `listId`.
- No multi-instance fan-out. The app runs as a single Node process, so an
  in-process event bus is sufficient (see "Deployment assumptions").

## Deployment assumptions

- App runs as a **single long-lived Node process** (self-hosted / VPS, `next
  start`), not serverless. SSE connections are held in that process's memory.
- A single process means an **in-process `EventEmitter`** is enough as the
  message bus — no Redis / Postgres `LISTEN/NOTIFY` needed. If the app is ever
  scaled to multiple instances, the bus would need to be replaced with a shared
  pub/sub; the bus module is the only seam that would change.

## Architecture

```
Client A ──POST/PATCH/DELETE──▶ REST route ──┐
                                             ├─▶ emitListEvent(listId, event)
Client A ◀── optimistic UI (unchanged) ──────┘            │  (in-process EventBus)
                                                          ▼
Client B ◀════ SSE stream  GET /events  ◀──── subscribeListEvents(listId)
```

1. A member mutates an item via the existing REST endpoints.
2. After the DB write succeeds, the route publishes a full-payload event to the
   in-process bus, keyed by `listId`.
3. Every other member holds an open SSE connection to that list's `/events`
   endpoint. The endpoint is subscribed to the bus and forwards matching events
   to the client.
4. The client applies the event directly to its React Query cache (no refetch
   per event), so the existing add/remove animations play.

## Components

### `lib/list-events.ts` — in-process event bus

A singleton `EventEmitter` stored on `globalThis` so it survives Next.js dev HMR
reloads (the same pattern as `lib/prisma.ts`).

```ts
export type ListEvent =
  | { type: 'item.added';   listId: string; originClientId: string | null; payload: ListItemDTO }
  | { type: 'item.updated'; listId: string; originClientId: string | null; payload: ListItemDTO }
  | { type: 'item.deleted'; listId: string; originClientId: string | null; payload: { id: string } }

export function emitListEvent(listId: string, event: ListEvent): void
export function subscribeListEvents(
  listId: string,
  handler: (event: ListEvent) => void,
): () => void   // returns unsubscribe
```

- Events are namespaced by `listId` internally (e.g. emitter event name
  `list:${listId}`) so a subscriber only receives its own list's events.
- `subscribeListEvents` returns an unsubscribe function for cleanup.
- `ListItemDTO` is the item shape REST already returns (`include createdBy`,
  `checkedBy` selected to `{ id, name }`). `payload` for `added`/`updated` is
  exactly that shape, so the client can drop it straight into the cache.

### `app/api/lists/[id]/events/route.ts` — SSE endpoint

- `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.
- `GET` only.
- Auth: `getSession()` → 401 if absent; `requireListAccess(session.userId,
  params.id)` → 401/403/404 exactly like the REST routes.
- Reads `clientId` from the query string (`?clientId=…`).
- Returns a `ReadableStream` with headers:
  `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`.
- On start: `subscribeListEvents(params.id, handler)`. The handler serializes the
  event as `data: ${JSON.stringify(event)}\n\n` and enqueues it — **unless**
  `event.originClientId === clientId`, in which case it is skipped (the
  originating tab already applied it optimistically).
- **Heartbeat**: every **15 s**, enqueue a comment line `:\n\n` to keep
  proxies/load balancers from dropping an idle connection.
- **Cleanup**: on `request.signal` `abort` (client disconnected), call the
  unsubscribe function and `clearInterval(heartbeat)`, then close the stream — so
  subscriptions and timers don't leak.

### Emitting from mutation routes

In the existing routes, **after** the DB write succeeds, read `originClientId`
from the `x-client-id` request header and emit:

| Route | Event |
|-------|-------|
| `POST   /api/lists/[id]/items`            | `item.added`   with the created item |
| `PATCH  /api/lists/[id]/items/[itemId]`   | `item.updated` with the updated item |
| `DELETE /api/lists/[id]/items/[itemId]`   | `item.deleted` with `{ id }` |

The emitted `payload` for `added`/`updated` is the same object the route already
returns to the caller (same `include`). Emitting happens after a successful write
and before/after the response is constructed — it must not affect the HTTP
response or fail the request if no subscribers exist (`emit` is fire-and-forget).

### Client — `useListEvents(listId)` hook

Used by the list detail page (`app/(app)/lists/[id]/page.tsx`).

- On mount, generate a per-tab `clientId` (`crypto.randomUUID()`), stable for the
  tab's lifetime (e.g. `useRef`).
- Expose the `clientId` so the page's mutation `fetch` calls send it as the
  `x-client-id` header (add/toggle/delete).
- Open `new EventSource('/api/lists/${listId}/events?clientId=${clientId}')`.
- **`onmessage`**: parse the event and update the React Query cache for
  `['items', listId]` via `queryClient.setQueryData`:
  - `item.added`   → append if `id` not present (dedupe), then re-sort.
  - `item.updated` → replace the item with matching `id`, then re-sort.
  - `item.deleted` → remove the item with matching `id`.
  - Re-sort uses a **shared comparator** matching the server order
    (`checkedAt` desc nulls-first, then `createdAt` desc) so every client shows
    the same ordering. Extract this comparator so the route's `orderBy` intent
    and the client agree.
- **`onopen`**: `queryClient.invalidateQueries(['items', listId])` once — a
  resync baseline that closes any gap of events missed while disconnected
  (EventSource auto-reconnects on drop, and `onopen` fires again on reconnect).
- **`onerror`**: rely on EventSource's built-in auto-reconnect. No redirect
  handling here — the page's existing REST calls already detect access loss via
  `handleAccessLost` and redirect.
- On unmount: `eventSource.close()`.

## Why `originClientId` (per-tab), not `actorId` (per-user)

Skipping the originating client avoids duplicate/flicker on the author's tab,
which already applied the change optimistically. Filtering by **user id** would
be wrong: a user with the list open on a second device would never receive live
updates for their own actions. A per-tab `clientId` skips only the exact tab that
issued the mutation, so a second device (different `clientId`) still gets the
event. The mutation carries `x-client-id`; the SSE connection carries the same id
in `?clientId`; the server compares them per subscriber.

## Data flow (example: B adds an item, A and B both viewing)

1. B's page issues `POST /items` with header `x-client-id: B-tab`.
2. Route writes the item, returns it to B (B reconciles optimistic row), and
   emits `item.added` with `originClientId: B-tab`.
3. Bus delivers to all subscribers of `list:${listId}`:
   - B's SSE connection (`clientId: B-tab`) → **skipped** (origin match).
   - A's SSE connection (`clientId: A-tab`) → writes `data: …\n\n`.
4. A's `onmessage` inserts the item into `['items', listId]`, re-sorts; the
   add animation plays.

## Error handling

- **SSE auth failure** → standard 401/403/404 JSON response; EventSource fires
  `onerror` and retries. Access-loss redirects are handled by the existing REST
  flow, not here.
- **No subscribers** → `emit` is a no-op; mutations are unaffected.
- **Client disconnect** → `request.signal` abort triggers unsubscribe +
  `clearInterval`; no leaked subscriptions or timers.
- **Missed events during a drop** → covered by the `onopen` resync invalidation.
- **Heartbeat** → 15 s comment frames prevent idle-connection timeouts.

## Testing

- **Bus unit tests** (`lib/list-events`): emit → subscribed handler receives it;
  isolation between different `listId`s; unsubscribe stops delivery.
- **Mutation route tests**: after a successful add/patch/delete, `emitListEvent`
  is called with the correct `type`, `payload`, and `originClientId` (spy on the
  bus). Uses `next-test-api-route-handler` as the existing route tests do.
- **SSE route tests**: access gating returns 401/403 for unauthorized users; a
  subscribed handler receives a written event; an event whose `originClientId`
  matches the connection's `clientId` is skipped.
- **Client hook test** with a mocked `EventSource`: `item.added` /
  `item.updated` / `item.deleted` mutate the cache correctly and re-sort; `onopen`
  triggers an invalidation.

## Possible extensions (not in v1)

- Membership change events (member joined/left/removed) for the members panel.
- List rename / delete events.
- Presence / "X is editing" indicators (would benefit from WebSocket).
- Multi-instance fan-out via Redis or Postgres `LISTEN/NOTIFY` if horizontally
  scaled.
