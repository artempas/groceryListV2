# Real-time List Sync (SSE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate item add/check/delete made by one list member to every other member viewing the same list in real time, over Server-Sent Events.

**Architecture:** REST mutations stay unchanged; after each successful write the route publishes a full-payload event to an in-process `EventEmitter` bus keyed by `listId`. A new SSE endpoint subscribes to the bus and streams events to connected clients. A client hook applies events directly to the React Query `['items', listId]` cache. A per-tab `clientId` (sent as `x-client-id` on mutations, `?clientId` on the SSE URL) lets the server skip echoing an event back to the tab that caused it.

**Tech Stack:** Next.js 14 App Router (route handlers, `ReadableStream`), Node `events.EventEmitter`, browser `EventSource`, React Query v5, Jest + `next-test-api-route-handler` + `@testing-library/react`.

## Global Constraints

- Single Node process — in-process `EventEmitter` is the bus; no Redis / Postgres LISTEN-NOTIFY.
- Only `item.added` / `item.updated` / `item.deleted` events, routed per `listId`. No list-level or membership events.
- SSE heartbeat interval is **15 seconds** (comment frame `:\n\n`).
- Auth on the SSE endpoint uses the same `getSession()` + `requireListAccess()` as the REST routes.
- Event payloads for `added`/`updated` are the exact object the REST route returns (`include createdBy`, `checkedBy` selected to `{ id, name }`). Over the wire `Date` fields serialize to ISO strings.
- Follow existing code style: `lib/*.ts` modules, kebab-case filenames, tests under `tests/` mirroring source paths, no semicolons.

---

## File Structure

- Create `lib/list-events.ts` — in-process event bus (singleton EventEmitter, emit/subscribe).
- Create `lib/sort-items.ts` — shared comparator matching the server's item ordering.
- Create `app/api/lists/[id]/events/route.ts` — SSE endpoint.
- Create `app/(app)/lists/[id]/use-list-events.ts` — client hook; returns the per-tab `clientId` and applies events to the cache.
- Create `tests/helpers/mock-event-source.ts` — `EventSource` mock for jsdom tests.
- Modify `app/api/lists/[id]/items/route.ts` — emit `item.added` after create.
- Modify `app/api/lists/[id]/items/[itemId]/route.ts` — emit `item.updated` / `item.deleted`.
- Modify `app/(app)/lists/[id]/page.tsx` — call the hook, thread `clientId` into the three mutation fetch helpers.
- Modify `jest.setup.ts` — install the `EventSource` mock globally.

---

### Task 1: In-process event bus

**Files:**
- Create: `lib/list-events.ts`
- Test: `tests/lib/list-events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ListItemDTO { id: string; name: string; category: string | null; listId: string; createdAt: string | Date; checkedAt: string | Date | null; createdBy: { id: string; name: string }; checkedBy: { id: string; name: string } | null }`
  - `type ListEvent = { type: 'item.added'; listId: string; originClientId: string | null; payload: ListItemDTO } | { type: 'item.updated'; listId: string; originClientId: string | null; payload: ListItemDTO } | { type: 'item.deleted'; listId: string; originClientId: string | null; payload: { id: string } }`
  - `emitListEvent(listId: string, event: ListEvent): void`
  - `subscribeListEvents(listId: string, handler: (event: ListEvent) => void): () => void` (returns unsubscribe)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/list-events.test.ts
import { emitListEvent, subscribeListEvents, type ListEvent } from '@/lib/list-events'

function addedEvent(listId: string, id: string): ListEvent {
  return {
    type: 'item.added',
    listId,
    originClientId: null,
    payload: {
      id, name: 'Milk', category: null, listId,
      createdAt: '2026-06-19T00:00:00.000Z', checkedAt: null,
      createdBy: { id: 'u1', name: 'A' }, checkedBy: null,
    },
  }
}

describe('list-events bus', () => {
  it('delivers an emitted event to a subscriber of the same list', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    emitListEvent('list-1', addedEvent('list-1', 'item-1'))
    unsub()
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('item.added')
  })

  it('does not deliver events from a different list', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    emitListEvent('list-2', addedEvent('list-2', 'item-2'))
    unsub()
    expect(received).toHaveLength(0)
  })

  it('stops delivering after unsubscribe', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    unsub()
    emitListEvent('list-1', addedEvent('list-1', 'item-3'))
    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/list-events.test.ts`
Expected: FAIL — cannot find module `@/lib/list-events`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/list-events.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/list-events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/list-events.ts tests/lib/list-events.test.ts
git commit -m "feat: in-process event bus for list item changes"
```

---

### Task 2: Shared item-sort comparator

**Files:**
- Create: `lib/sort-items.ts`
- Test: `tests/lib/sort-items.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SortableItem { checkedAt: string | Date | null; createdAt: string | Date }`
  - `compareItems(a: SortableItem, b: SortableItem): number`
  - `sortItems<T extends SortableItem>(items: T[]): T[]` (returns a new sorted array)

Mirrors the server `orderBy: [{ checkedAt: desc, nulls: first }, { createdAt: desc }]`: unchecked items (null `checkedAt`) first; among checked, most-recently-checked first; ties broken by newest `createdAt` first.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/sort-items.test.ts
import { sortItems } from '@/lib/sort-items'

const mk = (id: string, createdAt: string, checkedAt: string | null) => ({ id, createdAt, checkedAt })

describe('sortItems', () => {
  it('puts unchecked items before checked items', () => {
    const checked = mk('a', '2026-06-19T10:00:00.000Z', '2026-06-19T11:00:00.000Z')
    const unchecked = mk('b', '2026-06-19T09:00:00.000Z', null)
    const out = sortItems([checked, unchecked])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('orders unchecked items by newest createdAt first', () => {
    const older = mk('a', '2026-06-19T09:00:00.000Z', null)
    const newer = mk('b', '2026-06-19T10:00:00.000Z', null)
    const out = sortItems([older, newer])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('orders checked items by most-recently-checked first', () => {
    const checkedEarly = mk('a', '2026-06-19T08:00:00.000Z', '2026-06-19T10:00:00.000Z')
    const checkedLate = mk('b', '2026-06-19T08:00:00.000Z', '2026-06-19T12:00:00.000Z')
    const out = sortItems([checkedEarly, checkedLate])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const input = [mk('a', '2026-06-19T09:00:00.000Z', null), mk('b', '2026-06-19T10:00:00.000Z', null)]
    sortItems(input)
    expect(input.map((i) => i.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/sort-items.test.ts`
Expected: FAIL — cannot find module `@/lib/sort-items`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/sort-items.ts
export interface SortableItem {
  checkedAt: string | Date | null
  createdAt: string | Date
}

function toMillis(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

// Matches the server orderBy: [{ checkedAt: desc, nulls: first }, { createdAt: desc }].
export function compareItems(a: SortableItem, b: SortableItem): number {
  const aUnchecked = a.checkedAt === null
  const bUnchecked = b.checkedAt === null
  if (aUnchecked !== bUnchecked) return aUnchecked ? -1 : 1

  if (!aUnchecked && !bUnchecked) {
    const diff = toMillis(b.checkedAt as string | Date) - toMillis(a.checkedAt as string | Date)
    if (diff !== 0) return diff
  }

  return toMillis(b.createdAt) - toMillis(a.createdAt)
}

export function sortItems<T extends SortableItem>(items: T[]): T[] {
  return [...items].sort(compareItems)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/sort-items.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sort-items.ts tests/lib/sort-items.test.ts
git commit -m "feat: shared item-sort comparator matching server order"
```

---

### Task 3: SSE endpoint

**Files:**
- Create: `app/api/lists/[id]/events/route.ts`
- Test: `tests/api/list-events-sse.test.ts`

**Interfaces:**
- Consumes: `subscribeListEvents`, `ListEvent` (Task 1); `getSession` (`@/lib/auth`); `requireListAccess` (`@/lib/access`).
- Produces: `GET` route handler streaming `text/event-stream`.

Auth gating returns 401/403/404 like the REST routes. The stream subscribes to the bus on start, skips events whose `originClientId` equals the connection's `?clientId`, sends a 15s heartbeat, and unsubscribes on cancel/abort.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/list-events-sse.test.ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as sseHandler from '@/app/api/lists/[id]/events/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { emitListEvent } from '@/lib/list-events'

const mockGetSession = getSession as jest.Mock
const list = { id: 'list-1', name: 'G', ownerId: 'user-1', createdAt: new Date() }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
  mockGetSession.mockResolvedValue({ userId: 'user-1', email: 'a@b.com' })
  ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(list)
})

async function readFirstData(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  // Skip heartbeat comment frames (":\n\n"), return on the first "data:" frame.
  for (let i = 0; i < 10; i++) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    if (buffer.includes('data:')) return buffer
  }
  return buffer
}

it('returns 401 without a session', async () => {
  mockGetSession.mockResolvedValue(null)
  await testApiHandler({
    appHandler: sseHandler,
    params: { id: 'list-1' },
    async test({ fetch }) {
      const res = await fetch({ method: 'GET' })
      expect(res.status).toBe(401)
    },
  })
})

it('returns 403 for a non-member', async () => {
  mockGetSession.mockResolvedValue({ userId: 'stranger', email: 's@x.com' })
  ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({ ...list, ownerId: 'owner-1' })
  ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)
  await testApiHandler({
    appHandler: sseHandler,
    params: { id: 'list-1' },
    async test({ fetch }) {
      const res = await fetch({ method: 'GET' })
      expect(res.status).toBe(403)
    },
  })
})

it('streams an emitted event to a connected client', async () => {
  await testApiHandler({
    appHandler: sseHandler,
    url: '/api/lists/list-1/events?clientId=reader-tab',
    params: { id: 'list-1' },
    async test({ fetch }) {
      const res = await fetch({ method: 'GET' })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const reader = res.body!.getReader()
      emitListEvent('list-1', {
        type: 'item.added', listId: 'list-1', originClientId: 'other-tab',
        payload: {
          id: 'item-9', name: 'Bread', category: null, listId: 'list-1',
          createdAt: new Date('2026-06-19T00:00:00.000Z'), checkedAt: null,
          createdBy: { id: 'user-1', name: 'A' }, checkedBy: null,
        },
      })
      const text = await readFirstData(reader)
      expect(text).toContain('item.added')
      expect(text).toContain('Bread')
      await reader.cancel()
    },
  })
})

it('skips an event originating from the same clientId', async () => {
  await testApiHandler({
    appHandler: sseHandler,
    url: '/api/lists/list-1/events?clientId=reader-tab',
    params: { id: 'list-1' },
    async test({ fetch }) {
      const res = await fetch({ method: 'GET' })
      const reader = res.body!.getReader()
      // This one must be skipped (same clientId)...
      emitListEvent('list-1', {
        type: 'item.deleted', listId: 'list-1', originClientId: 'reader-tab',
        payload: { id: 'skip-me' },
      })
      // ...and this one delivered. First data frame must be the delivered one.
      emitListEvent('list-1', {
        type: 'item.deleted', listId: 'list-1', originClientId: 'other-tab',
        payload: { id: 'keep-me' },
      })
      const text = await readFirstData(reader)
      expect(text).toContain('keep-me')
      expect(text).not.toContain('skip-me')
      await reader.cancel()
    },
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/api/list-events-sse.test.ts`
Expected: FAIL — cannot find module `@/app/api/lists/[id]/events/route`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/lists/[id]/events/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'
import { subscribeListEvents, type ListEvent } from '@/lib/list-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const clientId = new URL(request.url).searchParams.get('clientId')
  const encoder = new TextEncoder()

  let unsubscribe: () => void = () => {}
  let heartbeat: ReturnType<typeof setInterval>

  const cleanup = () => {
    unsubscribe()
    clearInterval(heartbeat)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ListEvent) => {
        // Don't echo an event back to the tab that caused it; it already applied it optimistically.
        if (clientId && event.originClientId === clientId) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      unsubscribe = subscribeListEvents(params.id, send)
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`:\n\n`))
      }, HEARTBEAT_MS)
    },
    cancel() {
      cleanup()
    },
  })

  request.signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/api/list-events-sse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add 'app/api/lists/[id]/events/route.ts' tests/api/list-events-sse.test.ts
git commit -m "feat: SSE endpoint streaming list item events"
```

---

### Task 4: Emit events from mutation routes

**Files:**
- Modify: `app/api/lists/[id]/items/route.ts` (POST handler)
- Modify: `app/api/lists/[id]/items/[itemId]/route.ts` (PATCH and DELETE handlers)
- Test: `tests/api/items.test.ts` (extend existing)

**Interfaces:**
- Consumes: `emitListEvent` (Task 1).
- Produces: side-effect emits on the bus — `item.added` (POST), `item.updated` (PATCH), `item.deleted` (DELETE), each with `originClientId` from the `x-client-id` request header.

- [ ] **Step 1: Write the failing test**

Add the mock near the other `jest.mock` calls at the top of `tests/api/items.test.ts`:

```ts
jest.mock('@/lib/list-events', () => ({ emitListEvent: jest.fn() }))
```

Add the import alongside the existing imports:

```ts
import { emitListEvent } from '@/lib/list-events'
const mockEmit = emitListEvent as jest.Mock
```

Append this describe block to `tests/api/items.test.ts`:

```ts
describe('list event emission', () => {
  it('emits item.added with the originClientId header after POST', async () => {
    mockCategorize.mockResolvedValue(null)
    mockItem.create.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-client-id': 'tab-1' },
          body: JSON.stringify({ name: 'Milk' }),
        })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.added',
      originClientId: 'tab-1',
      payload: expect.objectContaining({ id: 'item-1' }),
    }))
  })

  it('emits item.updated after PATCH', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.update.mockResolvedValue({ ...item, checkedAt: new Date(), checkedById: 'user-1' })

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-client-id': 'tab-1' },
          body: JSON.stringify({ checked: true }),
        })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.updated', originClientId: 'tab-1',
    }))
  })

  it('emits item.deleted after DELETE', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.delete.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({ method: 'DELETE', headers: { 'x-client-id': 'tab-1' } })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.deleted', originClientId: 'tab-1', payload: { id: 'item-1' },
    }))
  })

  it('emits with originClientId null when header is absent', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.delete.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({ method: 'DELETE' })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      originClientId: null,
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/api/items.test.ts -t "list event emission"`
Expected: FAIL — `emitListEvent` not called (routes don't emit yet).

- [ ] **Step 3: Write minimal implementation**

In `app/api/lists/[id]/items/route.ts`, add the import at the top:

```ts
import { emitListEvent } from '@/lib/list-events'
```

In the `POST` handler, replace the final return with an emit then return:

```ts
  const item = await prisma.listItem.create({
    data: { name: trimmed, category, listId: params.id, createdById: session.userId },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  emitListEvent(params.id, {
    type: 'item.added',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: item,
  })

  return NextResponse.json({ data: item }, { status: 201 })
```

In `app/api/lists/[id]/items/[itemId]/route.ts`, add the import at the top:

```ts
import { emitListEvent } from '@/lib/list-events'
```

In the `PATCH` handler, emit before returning the updated item:

```ts
  emitListEvent(params.id, {
    type: 'item.updated',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: updated,
  })

  return NextResponse.json({ data: updated })
```

In the `DELETE` handler, change the signature so the request is available, and emit after delete. Replace:

```ts
export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
```

with:

```ts
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
```

and replace the delete+return tail:

```ts
  await prisma.listItem.delete({ where: { id: params.itemId } })

  emitListEvent(params.id, {
    type: 'item.deleted',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: { id: params.itemId },
  })

  return NextResponse.json({ data: null })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/api/items.test.ts`
Expected: PASS (existing tests + the new "list event emission" block).

- [ ] **Step 5: Commit**

```bash
git add 'app/api/lists/[id]/items/route.ts' 'app/api/lists/[id]/items/[itemId]/route.ts' tests/api/items.test.ts
git commit -m "feat: emit list events from item mutation routes"
```

---

### Task 5: Client hook + EventSource test mock

**Files:**
- Create: `tests/helpers/mock-event-source.ts`
- Modify: `jest.setup.ts`
- Create: `app/(app)/lists/[id]/use-list-events.ts`
- Test: `tests/components/use-list-events.test.tsx`

**Interfaces:**
- Consumes: `ListEvent`, `ListItemDTO` (Task 1, type-only import); `sortItems` (Task 2); React Query `useQueryClient`.
- Produces:
  - `useListEvents(listId: string): string` — opens an `EventSource`, applies events to `['items', listId]`, invalidates on open; returns the per-tab `clientId`.
  - `class MockEventSource` with static `instances: MockEventSource[]`, static `reset()`, instance fields `url`, `onmessage`, `onopen`, `onerror`, `close()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers/mock-event-source.ts
export class MockEventSource {
  static instances: MockEventSource[] = []
  static reset() {
    MockEventSource.instances = []
  }

  url: string
  onmessage: ((e: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }
}
```

```tsx
// tests/components/use-list-events.test.tsx
/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MockEventSource } from '../helpers/mock-event-source'
import { useListEvents } from '@/app/(app)/lists/[id]/use-list-events'
import type { ListEvent } from '@/lib/list-events'

const existing = {
  id: 'item-1', name: 'Milk', category: null, listId: 'list-1',
  createdAt: '2026-06-19T09:00:00.000Z', checkedAt: null,
  createdBy: { id: 'u1', name: 'A' }, checkedBy: null,
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['items', 'list-1'], [existing])
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useListEvents('list-1'), { wrapper })
  return { qc, clientId: result.current, es: MockEventSource.instances[0] }
}

beforeEach(() => MockEventSource.reset())

function send(es: MockEventSource, event: ListEvent) {
  act(() => es.onmessage!({ data: JSON.stringify(event) }))
}

test('opens an EventSource carrying the returned clientId', () => {
  const { es, clientId } = setup()
  expect(es.url).toBe(`/api/lists/list-1/events?clientId=${clientId}`)
})

test('item.added appends the item to the cache', () => {
  const { qc, es } = setup()
  send(es, {
    type: 'item.added', listId: 'list-1', originClientId: 'other',
    payload: { ...existing, id: 'item-2', name: 'Bread', createdAt: '2026-06-19T10:00:00.000Z' },
  })
  const items = qc.getQueryData<typeof existing[]>(['items', 'list-1'])!
  expect(items.map((i) => i.id)).toEqual(['item-2', 'item-1']) // newer first
})

test('item.added is idempotent on duplicate id', () => {
  const { qc, es } = setup()
  send(es, {
    type: 'item.added', listId: 'list-1', originClientId: 'other', payload: existing,
  })
  expect(qc.getQueryData<typeof existing[]>(['items', 'list-1'])).toHaveLength(1)
})

test('item.updated replaces the matching item', () => {
  const { qc, es } = setup()
  send(es, {
    type: 'item.updated', listId: 'list-1', originClientId: 'other',
    payload: { ...existing, name: 'Oat Milk' },
  })
  const items = qc.getQueryData<typeof existing[]>(['items', 'list-1'])!
  expect(items[0].name).toBe('Oat Milk')
})

test('item.deleted removes the matching item', () => {
  const { qc, es } = setup()
  send(es, {
    type: 'item.deleted', listId: 'list-1', originClientId: 'other', payload: { id: 'item-1' },
  })
  expect(qc.getQueryData<typeof existing[]>(['items', 'list-1'])).toHaveLength(0)
})

test('onopen invalidates the items query', () => {
  const { qc, es } = setup()
  const spy = jest.spyOn(qc, 'invalidateQueries')
  act(() => es.onopen!())
  expect(spy).toHaveBeenCalledWith({ queryKey: ['items', 'list-1'] })
})

test('closes the EventSource on unmount', () => {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { unmount } = renderHook(() => useListEvents('list-1'), { wrapper })
  const es = MockEventSource.instances[0]
  unmount()
  expect(es.closed).toBe(true)
})
```

Modify `jest.setup.ts` to install the mock globally (so any component rendering the page also has `EventSource`):

```ts
import '@testing-library/jest-dom'
import { MockEventSource } from './tests/helpers/mock-event-source'

;(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/components/use-list-events.test.tsx`
Expected: FAIL — cannot find module `@/app/(app)/lists/[id]/use-list-events`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/(app)/lists/[id]/use-list-events.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/components/use-list-events.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/mock-event-source.ts jest.setup.ts 'app/(app)/lists/[id]/use-list-events.ts' tests/components/use-list-events.test.tsx
git commit -m "feat: useListEvents hook applying SSE events to the items cache"
```

---

### Task 6: Wire the hook into the list page

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx`
- Test: `tests/components/list-detail-realtime.test.tsx`

**Interfaces:**
- Consumes: `useListEvents` (Task 5).
- Produces: live updates rendered on the list detail page; mutations carry `x-client-id`.

The three module-level fetch helpers gain a `clientId` parameter and send it as `x-client-id`. The component calls `useListEvents(listId)` and passes the returned `clientId` into each mutation.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/list-detail-realtime.test.tsx
/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MockEventSource } from '../helpers/mock-event-source'
import ListDetailPage from '@/app/(app)/lists/[id]/page'
import type { ListEvent } from '@/lib/list-events'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'list-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

const listMeta = { id: 'list-1', name: 'Покупки', isOwner: true, owner: { id: 'u1', name: 'Аня' } }
const me = { id: 'u1', name: 'Аня' }

function jsonOk(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) }
}

beforeEach(() => {
  MockEventSource.reset()
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url === '/api/auth/me') return Promise.resolve(jsonOk(me))
    if (url === '/api/lists/list-1' ) return Promise.resolve(jsonOk(listMeta))
    if (url === '/api/lists/list-1/items') return Promise.resolve(jsonOk([]))
    return Promise.resolve(jsonOk([]))
  }) as unknown as typeof fetch
})

afterEach(() => jest.restoreAllMocks())

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ListDetailPage />
    </QueryClientProvider>,
  )
}

test('renders an item pushed via a server-sent event', async () => {
  renderPage()
  // The page mounts and opens the SSE connection.
  await screen.findByPlaceholderText('Добавить позицию…')
  const es = MockEventSource.instances[0]
  expect(es).toBeDefined()

  const event: ListEvent = {
    type: 'item.added', listId: 'list-1', originClientId: 'someone-else',
    payload: {
      id: 'item-remote', name: 'Хлеб', category: null, listId: 'list-1',
      createdAt: '2026-06-19T10:00:00.000Z', checkedAt: null,
      createdBy: { id: 'u2', name: 'Боря' }, checkedBy: null,
    },
  }
  act(() => es.onmessage!({ data: JSON.stringify(event) }))

  expect(await screen.findByText('Хлеб')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/components/list-detail-realtime.test.tsx`
Expected: FAIL — `MockEventSource.instances[0]` is undefined (the page doesn't open an EventSource yet).

- [ ] **Step 3: Write minimal implementation**

In `app/(app)/lists/[id]/page.tsx`, add the import near the other local imports:

```ts
import { useListEvents } from './use-list-events'
```

Update the three fetch helpers to accept and send `clientId`. Replace `addItem`:

```ts
async function addItem(listId: string, name: string, clientId: string): Promise<ListItem> {
  const res = await fetch(`/api/lists/${listId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось добавить позицию')
  }
  const json = await res.json()
  return json.data
}
```

Replace `toggleItem`:

```ts
async function toggleItem(
  listId: string,
  itemId: string,
  checked: boolean,
  clientId: string,
): Promise<ListItem> {
  const res = await fetch(`/api/lists/${listId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-client-id': clientId },
    body: JSON.stringify({ checked }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось обновить позицию')
  }
  const json = await res.json()
  return json.data
}
```

Replace `deleteItem`:

```ts
async function deleteItem(listId: string, itemId: string, clientId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/items/${itemId}`, {
    method: 'DELETE',
    headers: { 'x-client-id': clientId },
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось удалить позицию')
  }
}
```

In the `ListDetailPage` component, add the hook call right after `const listId = params.id` (around line 347):

```ts
  const clientId = useListEvents(listId)
```

Update the three mutation `mutationFn`s to pass `clientId`:

```ts
    mutationFn: (name: string) => addItem(listId, name, clientId),
```

```ts
    mutationFn: ({ itemId, checked }: { itemId: string; checked: boolean }) =>
      toggleItem(listId, itemId, checked, clientId),
```

```ts
    mutationFn: (itemId: string) => deleteItem(listId, itemId, clientId),
```

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — all suites, including the existing `tests/components/list-detail-add.test.tsx` (now exercising the global `EventSource` mock) and the new realtime test.

- [ ] **Step 5: Commit**

```bash
git add 'app/(app)/lists/[id]/page.tsx' tests/components/list-detail-realtime.test.tsx
git commit -m "feat: live-sync list items on the detail page via SSE"
```

---

## Self-Review

**Spec coverage:**
- In-process bus (single process) → Task 1. ✓
- SSE endpoint with auth gating, heartbeat 15s, originClientId skip, cleanup → Task 3. ✓
- Full-payload `item.added/updated/deleted` events routed per `listId` → Tasks 1, 4. ✓
- Emit from POST/PATCH/DELETE with `x-client-id` → Task 4. ✓
- Per-tab `clientId` threaded through mutations and SSE URL → Tasks 5, 6. ✓
- Client cache application (add/dedupe, update, delete) + shared comparator re-sort → Tasks 2, 5. ✓
- `onopen` resync invalidation → Task 5. ✓
- Reliance on existing `handleAccessLost` for access-loss redirects; no redirect logic in hook → Task 5 (hook has no onerror redirect). ✓
- Testing: bus unit, mutation emit, SSE gating + delivery + skip, client hook, integration → Tasks 1–6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ListEvent` / `ListItemDTO` defined in Task 1 and imported type-only in Tasks 3, 5, 6 and tests. `emitListEvent(listId, event)` / `subscribeListEvents(listId, handler) => unsubscribe` signatures consistent across Tasks 1, 3, 4. `sortItems` / `compareItems` from Task 2 used in Tasks 2, 5. `useListEvents(listId): string` from Task 5 used in Task 6. Fetch helper signatures (`addItem(listId, name, clientId)`, `toggleItem(listId, itemId, checked, clientId)`, `deleteItem(listId, itemId, clientId)`) consistent between Task 6's helper edits and `mutationFn` edits. ✓
