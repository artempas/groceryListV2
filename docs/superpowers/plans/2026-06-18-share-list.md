# Share List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement collaborative list sharing — owner generates a 24h share link, recipients register/login and join as members with full item-level access (add / check / delete), but cannot rename / delete / re-share the list.

**Architecture:** Add two Prisma models — `ListMembership` (many-to-many user↔list) and `ListInvite` (one row per list, PK=`listId`, opaque random token, 24h TTL). New shared auth helpers `requireListAccess` (owner OR member) and `requireListOwner` (owner only) replace inline ownership checks. New endpoints expose invite UPSERT, accept, members list, member-remove. UI gains an overflow menu on the list detail page (Share / Rename / Delete for owner; Leave for member), a Share sheet (link + members), and a shared-list badge on the dashboard. Long-press delete on the dashboard is removed.

**Tech Stack:** Next.js 14 (App Router), Prisma 7 (Postgres), React 18, @tanstack/react-query 5, Tailwind, jose JWT cookies, jest + next-test-api-route-handler, ts-jest. Source spec: `docs/superpowers/specs/2026-06-18-share-list-design.md`.

## Global Constraints

- All Russian-language UI strings must match the spec verbatim (quoted in tasks).
- Token format: `crypto.randomBytes(32).toString('base64url')` — 256 bit entropy.
- TTL: exactly 24 hours from generation; stored as UTC `DateTime`.
- Tests mock `@/lib/prisma` and `@/lib/auth`'s `getSession` — never a real DB. Pattern is established in `tests/api/lists.test.ts`.
- No UI component tests — `tests/` currently contains only API + lib tests; do not introduce React Testing Library coverage for new components.
- Existing endpoint responses (`{ data: ... }` envelope, error envelope `{ error: string }`) must be preserved exactly.
- New plan must keep `tests/` passing after every task — never commit with red tests.
- `next` query-param redirect destinations must start with `/` (open-redirect guard).
- `crypto` imports use Node `node:crypto` (server-only, never imported into client components).

---

## File map

**New files:**
- `lib/access.ts` — `requireListAccess`, `requireListOwner` helpers
- `lib/invite.ts` — `generateInviteToken()`, `INVITE_TTL_MS`
- `app/api/lists/[id]/invite/route.ts` — `POST` (owner)
- `app/api/lists/[id]/members/route.ts` — `GET` (access)
- `app/api/lists/[id]/members/[userId]/route.ts` — `DELETE` (owner or self)
- `app/api/invite/[token]/accept/route.ts` — `POST` (any logged-in)
- `app/invite/[token]/page.tsx` — invite acceptance RSC
- `tests/lib/access.test.ts`
- `tests/api/invite.test.ts` (POST accept)
- `tests/api/lists-invite.test.ts` (POST `/lists/[id]/invite`)
- `tests/api/lists-members.test.ts` (members GET + DELETE)

**Modified files:**
- `prisma/schema.prisma` — add `ListMembership`, `ListInvite`, relations
- `prisma/migrations/<timestamped>/migration.sql` — new migration
- `lib/auth.ts` — re-export from `lib/access.ts` is optional; not required
- `app/api/lists/route.ts` — `GET` includes shared lists, adds `owner` + `isOwner`
- `app/api/lists/[id]/route.ts` — adds `GET` handler (returns `name + owner + isOwner`); existing `PATCH`/`DELETE` keep owner-only via new helper
- `app/api/lists/[id]/items/route.ts` — switch to `requireListAccess`
- `app/api/lists/[id]/items/[itemId]/route.ts` — switch to `requireListAccess`
- `app/page.tsx` — remove long-press; add shared badge; handle 403; redirect to `/` on 403
- `app/(app)/lists/[id]/page.tsx` — drop `?name=` query; fetch list meta via `GET /api/lists/[id]`; add overflow menu + sheets; handle 403
- `app/(auth)/login/page.tsx` — read `next` query param, validate, redirect there on success (wrap in `Suspense`)
- `app/(auth)/register/page.tsx` — same as login
- `tests/api/lists.test.ts` — extend for new `GET /api/lists` shape, new `GET /api/lists/[id]` handler
- `tests/api/items.test.ts` — extend for member access (member can read/add/toggle/delete items)

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_sharing/migration.sql` (Prisma writes this)

**Interfaces:**
- Produces: Prisma client types `ListMembership`, `ListInvite`; relations `User.memberships`, `List.memberships`, `List.invite`.

- [ ] **Step 1: Replace `prisma/schema.prisma` contents**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model User {
  id           String           @id @default(cuid())
  email        String           @unique
  passwordHash String
  name         String
  createdAt    DateTime         @default(now())

  lists        List[]
  createdItems ListItem[]       @relation("ItemCreatedBy")
  checkedItems ListItem[]       @relation("ItemCheckedBy")
  memberships  ListMembership[]
}

model List {
  id          String           @id @default(cuid())
  name        String
  owner       User             @relation(fields: [ownerId], references: [id])
  ownerId     String
  createdAt   DateTime         @default(now())

  items       ListItem[]
  memberships ListMembership[]
  invite      ListInvite?
}

model ListItem {
  id          String    @id @default(cuid())
  name        String
  list        List      @relation(fields: [listId], references: [id], onDelete: Cascade)
  listId      String
  createdBy   User      @relation("ItemCreatedBy", fields: [createdById], references: [id])
  createdById String
  createdAt   DateTime  @default(now())
  checkedAt   DateTime?
  checkedBy   User?     @relation("ItemCheckedBy", fields: [checkedById], references: [id])
  checkedById String?
}

model ListMembership {
  list     List     @relation(fields: [listId], references: [id], onDelete: Cascade)
  listId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId   String
  joinedAt DateTime @default(now())

  @@id([listId, userId])
  @@index([userId])
}

model ListInvite {
  list      List     @relation(fields: [listId], references: [id], onDelete: Cascade)
  listId    String   @id
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name add_sharing --create-only`
Expected: a new directory under `prisma/migrations/` containing `migration.sql` with `CREATE TABLE "ListMembership"` and `CREATE TABLE "ListInvite"` statements, plus foreign keys. The migration is not yet applied; that's fine for tests (which mock prisma).

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `node_modules/.prisma/client` updated. New types `ListMembership` and `ListInvite` are importable from `@prisma/client`.

- [ ] **Step 4: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add ListMembership and ListInvite for list sharing"
```

---

### Task 2: `lib/access.ts` — auth helpers

**Files:**
- Create: `lib/access.ts`
- Create: `tests/lib/access.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`
- Produces:
  - `requireListAccess(userId: string, listId: string): Promise<AccessOk | AccessErr>`
  - `requireListOwner(userId: string, listId: string): Promise<OwnerOk | AccessErr>`
  - Types `AccessOk = { list: List; isOwner: boolean }`, `OwnerOk = { list: List }`, `AccessErr = { error: 'Not found' | 'Forbidden'; status: 404 | 403 }`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/access.test.ts`:
```ts
import { requireListAccess, requireListOwner } from '@/lib/access'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: { findUnique: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
const mockList = prisma.list as jest.Mocked<typeof prisma.list>
const mockMembership = prisma.listMembership as jest.Mocked<typeof prisma.listMembership>

const fakeList = { id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date() }

beforeEach(() => jest.clearAllMocks())

describe('requireListAccess', () => {
  it('returns 404 when list does not exist', async () => {
    mockList.findUnique.mockResolvedValue(null)
    const result = await requireListAccess('user-1', 'missing')
    expect(result).toEqual({ error: 'Not found', status: 404 })
  })

  it('returns isOwner=true for owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListAccess('owner-1', 'list-1')
    expect(result).toEqual({ list: fakeList, isOwner: true })
  })

  it('returns isOwner=false for member', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    mockMembership.findUnique.mockResolvedValue({
      listId: 'list-1', userId: 'member-1', joinedAt: new Date(),
    } as any)
    const result = await requireListAccess('member-1', 'list-1')
    expect(result).toEqual({ list: fakeList, isOwner: false })
  })

  it('returns 403 for non-member non-owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    mockMembership.findUnique.mockResolvedValue(null)
    const result = await requireListAccess('stranger', 'list-1')
    expect(result).toEqual({ error: 'Forbidden', status: 403 })
  })
})

describe('requireListOwner', () => {
  it('returns 404 when list does not exist', async () => {
    mockList.findUnique.mockResolvedValue(null)
    const result = await requireListOwner('user-1', 'missing')
    expect(result).toEqual({ error: 'Not found', status: 404 })
  })

  it('returns list for owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListOwner('owner-1', 'list-1')
    expect(result).toEqual({ list: fakeList })
  })

  it('returns 403 for non-owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListOwner('other-user', 'list-1')
    expect(result).toEqual({ error: 'Forbidden', status: 403 })
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx jest tests/lib/access.test.ts`
Expected: FAIL with `Cannot find module '@/lib/access'`.

- [ ] **Step 3: Implement `lib/access.ts`**

```ts
import { prisma } from '@/lib/prisma'
import type { List } from '@prisma/client'

export type AccessErr = { error: 'Not found' | 'Forbidden'; status: 404 | 403 }
export type AccessOk = { list: List; isOwner: boolean }
export type OwnerOk = { list: List }

export async function requireListAccess(
  userId: string,
  listId: string,
): Promise<AccessOk | AccessErr> {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId === userId) return { list, isOwner: true }

  const membership = await prisma.listMembership.findUnique({
    where: { listId_userId: { listId, userId } },
  })
  if (membership) return { list, isOwner: false }

  return { error: 'Forbidden', status: 403 }
}

export async function requireListOwner(
  userId: string,
  listId: string,
): Promise<OwnerOk | AccessErr> {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== userId) return { error: 'Forbidden', status: 403 }
  return { list }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest tests/lib/access.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/access.ts tests/lib/access.test.ts
git commit -m "feat(lib): add requireListAccess and requireListOwner helpers"
```

---

### Task 3: Refactor existing list endpoints + open items API to members

**Files:**
- Modify: `app/api/lists/[id]/route.ts`
- Modify: `app/api/lists/[id]/items/route.ts`
- Modify: `app/api/lists/[id]/items/[itemId]/route.ts`
- Modify: `tests/api/items.test.ts` — add member-access cases

**Interfaces:**
- Consumes: `requireListAccess`, `requireListOwner` from `@/lib/access`

This task replaces inline `list.ownerId !== userId` checks with the new helpers, and opens items endpoints to members. PATCH/DELETE on the list itself remain owner-only.

- [ ] **Step 1: Read current items test to understand fixtures**

Read `tests/api/items.test.ts` first to learn the mocking patterns and existing assertions.

- [ ] **Step 2: Add failing test for member item access**

In `tests/api/items.test.ts`, add at the end of the file (inside the existing top-level scope):

```ts
import * as itemsHandler from '@/app/api/lists/[id]/items/route'

describe('GET /api/lists/:id/items as member', () => {
  it('member can list items in shared list', async () => {
    mockGetSession.mockResolvedValue({ userId: 'member-1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date(),
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'member-1', joinedAt: new Date(),
    })
    ;(prisma.listItem.findMany as jest.Mock).mockResolvedValue([])

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('non-member gets 403', async () => {
    mockGetSession.mockResolvedValue({ userId: 'stranger', email: 's@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date(),
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(403)
      },
    })
  })
})
```

Also update the top-level `jest.mock('@/lib/prisma', ...)` in `tests/api/items.test.ts` to include `listMembership: { findUnique: jest.fn() }` in the mock structure.

- [ ] **Step 3: Run tests — expect failure**

Run: `npx jest tests/api/items.test.ts`
Expected: the two new tests fail. Pre-existing tests may also fail if mock shape differs — fix the mock setup until prior tests pass and only the new tests fail with 403/404 mismatches.

- [ ] **Step 4: Refactor `app/api/lists/[id]/items/route.ts`**

Replace contents with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const items = await prisma.listItem.findMany({
    where: { listId: params.id },
    orderBy: [{ checkedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ data: items })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const item = await prisma.listItem.create({
    data: { name: name.trim(), listId: params.id, createdById: session.userId },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ data: item }, { status: 201 })
}
```

- [ ] **Step 5: Refactor `app/api/lists/[id]/items/[itemId]/route.ts`**

Replace contents with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'

async function findItem(listId: string, itemId: string) {
  const item = await prisma.listItem.findUnique({ where: { id: itemId } })
  if (!item || item.listId !== listId) return null
  return item
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const item = await findItem(params.id, params.itemId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { checked } = await request.json()

  const updated = await prisma.listItem.update({
    where: { id: params.itemId },
    data: checked
      ? { checkedAt: new Date(), checkedById: session.userId }
      : { checkedAt: null, checkedById: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const item = await findItem(params.id, params.itemId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listItem.delete({ where: { id: params.itemId } })
  return NextResponse.json({ data: null })
}
```

- [ ] **Step 6: Refactor `app/api/lists/[id]/route.ts` to use helper**

Replace contents with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListOwner } from '@/lib/access'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const updated = await prisma.list.update({
    where: { id: params.id },
    data: { name: name.trim() },
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  await prisma.list.delete({ where: { id: params.id } })
  return NextResponse.json({ data: null })
}
```

- [ ] **Step 7: Update existing `tests/api/items.test.ts` and `tests/api/lists.test.ts` mock shape**

Both mock files must declare `listMembership: { findUnique: jest.fn() }` in their `jest.mock('@/lib/prisma', ...)` block. Existing tests where the user is the owner still pass because `requireListAccess` short-circuits on owner without touching `listMembership`.

- [ ] **Step 8: Run all tests — expect green**

Run: `npx jest`
Expected: all tests pass (including pre-existing ones and the new member-access tests).

- [ ] **Step 9: Commit**

```bash
git add app/api/lists/ tests/api/items.test.ts tests/api/lists.test.ts
git commit -m "feat(api): open items endpoints to list members via access helpers"
```

---

### Task 4: `GET /api/lists/[id]` — list metadata endpoint

**Files:**
- Modify: `app/api/lists/[id]/route.ts` — add `GET` handler
- Modify: `tests/api/lists.test.ts` — add tests for new GET

**Interfaces:**
- Produces: `GET /api/lists/[id]` returning `{ data: { id, name, isOwner, owner: { id, name } } }`

- [ ] **Step 1: Add failing tests in `tests/api/lists.test.ts`**

Append:

```ts
describe('GET /api/lists/:id', () => {
  it('returns list with isOwner=true for owner', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockList.findUnique.mockResolvedValue({
      ...fakeList,
      owner: { id: 'user-1', name: 'Alice' },
    } as any)

    await testApiHandler({
      appHandler: listHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.isOwner).toBe(true)
        expect(body.data.owner).toEqual({ id: 'user-1', name: 'Alice' })
      },
    })
  })

  it('returns isOwner=false for member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'member-1', email: 'm@x.com' })
    mockList.findUnique.mockResolvedValue({
      ...fakeList,
      owner: { id: 'user-1', name: 'Alice' },
    } as any)
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'member-1', joinedAt: new Date(),
    })

    await testApiHandler({
      appHandler: listHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.isOwner).toBe(false)
      },
    })
  })

  it('returns 403 for non-member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'stranger', email: 's@x.com' })
    mockList.findUnique.mockResolvedValue(fakeList as any)
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: listHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(403)
      },
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest tests/api/lists.test.ts -t 'GET /api/lists/:id'`
Expected: failures because handler doesn't export GET.

- [ ] **Step 3: Add GET to `app/api/lists/[id]/route.ts`**

At the top of the file add `requireListAccess` to the imports:

```ts
import { requireListAccess, requireListOwner } from '@/lib/access'
```

Add this export:

```ts
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await prisma.list.findUnique({
    where: { id: params.id },
    include: { owner: { select: { id: true, name: true } } },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = list.ownerId === session.userId
  if (!isOwner) {
    const membership = await prisma.listMembership.findUnique({
      where: { listId_userId: { listId: params.id, userId: session.userId } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    data: {
      id: list.id,
      name: list.name,
      isOwner,
      owner: list.owner,
    },
  })
}
```

(Note: we inline the access logic here rather than calling `requireListAccess`, because we want `findUnique` to include the owner relation. Alternatively, refactor `requireListAccess` to accept an `include` — leave that for a later refactor.)

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest tests/api/lists.test.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add app/api/lists/[id]/route.ts tests/api/lists.test.ts
git commit -m "feat(api): add GET /api/lists/[id] returning list meta + isOwner"
```

---

### Task 5: `lib/invite.ts` + `POST /api/lists/[id]/invite`

**Files:**
- Create: `lib/invite.ts`
- Create: `app/api/lists/[id]/invite/route.ts`
- Create: `tests/api/lists-invite.test.ts`

**Interfaces:**
- Produces:
  - `INVITE_TTL_MS = 24 * 60 * 60 * 1000` (constant)
  - `generateInviteToken(): string` — 32 random bytes base64url
  - `POST /api/lists/[id]/invite` → `{ data: { token, expiresAt } }` (owner only)

- [ ] **Step 1: Create `lib/invite.ts`**

```ts
import { randomBytes } from 'node:crypto'

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/api/lists-invite.test.ts`:

```ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as inviteHandler from '@/app/api/lists/[id]/invite/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listInvite: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

const mockGetSession = getSession as jest.Mock
const fakeList = { id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date() }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('POST /api/lists/:id/invite', () => {
  it('returns existing active invite without regenerating', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    const future = new Date(Date.now() + 60 * 60 * 1000)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', token: 'existing-token', expiresAt: future, createdAt: new Date(),
    })

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).toBe('existing-token')
        expect(prisma.listInvite.upsert).not.toHaveBeenCalled()
      },
    })
  })

  it('upserts new invite when none exists', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.listInvite.upsert as jest.Mock).mockImplementation(({ create }) =>
      Promise.resolve({ listId: 'list-1', ...create, createdAt: new Date() }),
    )

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).toEqual(expect.any(String))
        expect(body.data.token.length).toBeGreaterThan(20)
        expect(prisma.listInvite.upsert).toHaveBeenCalledTimes(1)
      },
    })
  })

  it('regenerates when existing invite is expired', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    const past = new Date(Date.now() - 60 * 60 * 1000)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', token: 'expired-token', expiresAt: past, createdAt: new Date(),
    })
    ;(prisma.listInvite.upsert as jest.Mock).mockImplementation(({ create }) =>
      Promise.resolve({ listId: 'list-1', ...create, createdAt: new Date() }),
    )

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).not.toBe('expired-token')
        expect(prisma.listInvite.upsert).toHaveBeenCalled()
      },
    })
  })

  it('returns 403 for non-owner', async () => {
    mockGetSession.mockResolvedValue({ userId: 'other', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(403)
      },
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(401)
      },
    })
  })
})
```

- [ ] **Step 3: Run — expect failure**

Run: `npx jest tests/api/lists-invite.test.ts`
Expected: fails (handler not found).

- [ ] **Step 4: Implement `app/api/lists/[id]/invite/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListOwner } from '@/lib/access'
import { INVITE_TTL_MS, generateInviteToken } from '@/lib/invite'

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const existing = await prisma.listInvite.findUnique({ where: { listId: params.id } })
  if (existing && existing.expiresAt > new Date()) {
    return NextResponse.json({
      data: { token: existing.token, expiresAt: existing.expiresAt },
    })
  }

  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await prisma.listInvite.upsert({
    where: { listId: params.id },
    create: { listId: params.id, token, expiresAt },
    update: { token, expiresAt },
  })

  return NextResponse.json({ data: { token: invite.token, expiresAt: invite.expiresAt } })
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx jest tests/api/lists-invite.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/invite.ts app/api/lists/[id]/invite/ tests/api/lists-invite.test.ts
git commit -m "feat(api): POST /api/lists/[id]/invite upserts share token"
```

---

### Task 6: `POST /api/invite/[token]/accept`

**Files:**
- Create: `app/api/invite/[token]/accept/route.ts`
- Create: `tests/api/invite.test.ts`

**Interfaces:**
- Produces: `POST /api/invite/[token]/accept` → 200 `{ data: { listId, listName } }` | 401 | 404 | 410

- [ ] **Step 1: Write failing tests**

Create `tests/api/invite.test.ts`:

```ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as acceptHandler from '@/app/api/invite/[token]/accept/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    listInvite: { findUnique: jest.fn() },
    listMembership: { upsert: jest.fn() },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
const mockGetSession = getSession as jest.Mock

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

const validInvite = {
  listId: 'list-1',
  token: 'good-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  list: { id: 'list-1', name: 'L', ownerId: 'owner-1' },
}

describe('POST /api/invite/:token/accept', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(401)
      },
    })
  })

  it('returns 404 when token does not exist', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-1', email: 'u@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'missing' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(404)
      },
    })
  })

  it('returns 410 when invite has expired', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-1', email: 'u@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      ...validInvite,
      expiresAt: new Date(Date.now() - 1000),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(410)
      },
    })
  })

  it('owner accepting their own invite gets 200 without creating membership', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toEqual({ listId: 'list-1', listName: 'L' })
        expect(prisma.listMembership.upsert).not.toHaveBeenCalled()
      },
    })
  })

  it('creates membership and returns 200 for non-owner', async () => {
    mockGetSession.mockResolvedValue({ userId: 'guest', email: 'g@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)
    ;(prisma.listMembership.upsert as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'guest', joinedAt: new Date(),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toEqual({ listId: 'list-1', listName: 'L' })
        expect(prisma.listMembership.upsert).toHaveBeenCalledWith({
          where: { listId_userId: { listId: 'list-1', userId: 'guest' } },
          create: { listId: 'list-1', userId: 'guest' },
          update: {},
        })
      },
    })
  })

  it('is idempotent — already-member returns 200', async () => {
    mockGetSession.mockResolvedValue({ userId: 'guest', email: 'g@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)
    ;(prisma.listMembership.upsert as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'guest', joinedAt: new Date(),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
      },
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest tests/api/invite.test.ts`
Expected: fails — handler not found.

- [ ] **Step 3: Implement `app/api/invite/[token]/accept/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function POST(_: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invite = await prisma.listInvite.findUnique({
    where: { token: params.token },
    include: { list: true },
  })
  if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (invite.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'Expired' }, { status: 410 })
  }

  const isOwner = invite.list.ownerId === session.userId
  if (!isOwner) {
    await prisma.listMembership.upsert({
      where: { listId_userId: { listId: invite.listId, userId: session.userId } },
      create: { listId: invite.listId, userId: session.userId },
      update: {},
    })
  }

  return NextResponse.json({
    data: { listId: invite.listId, listName: invite.list.name },
  })
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest tests/api/invite.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/invite/ tests/api/invite.test.ts
git commit -m "feat(api): POST /api/invite/[token]/accept with TTL and idempotency"
```

---

### Task 7: `GET /api/lists/[id]/members`

**Files:**
- Create: `app/api/lists/[id]/members/route.ts`
- Create: `tests/api/lists-members.test.ts`

**Interfaces:**
- Produces: `GET /api/lists/[id]/members` → `{ data: { owner: { id, name }, members: [{ id, name, joinedAt }] } }`

- [ ] **Step 1: Write failing tests**

Create `tests/api/lists-members.test.ts`:

```ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as membersHandler from '@/app/api/lists/[id]/members/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
const mockGetSession = getSession as jest.Mock

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('GET /api/lists/:id/members', () => {
  it('owner sees members list with owner block', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'm1', joinedAt: new Date(), user: { id: 'm1', name: 'Bob' } },
    ])

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.owner).toEqual({ id: 'owner-1', name: 'Alice' })
        expect(body.data.members).toHaveLength(1)
        expect(body.data.members[0].name).toBe('Bob')
      },
    })
  })

  it('member can see members list', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.findMany as jest.Mock).mockResolvedValue([])

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('returns 403 for non-member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'stranger', email: 's@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(403)
      },
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest tests/api/lists-members.test.ts`
Expected: handler not found.

- [ ] **Step 3: Implement handler**

Create `app/api/lists/[id]/members/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await prisma.list.findUnique({
    where: { id: params.id },
    include: { owner: { select: { id: true, name: true } } },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = list.ownerId === session.userId
  if (!isOwner) {
    const membership = await prisma.listMembership.findUnique({
      where: { listId_userId: { listId: params.id, userId: session.userId } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const memberships = await prisma.listMembership.findMany({
    where: { listId: params.id },
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  })

  const members = memberships.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    joinedAt: m.joinedAt,
  }))

  return NextResponse.json({ data: { owner: list.owner, members } })
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest tests/api/lists-members.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/lists/[id]/members/ tests/api/lists-members.test.ts
git commit -m "feat(api): GET /api/lists/[id]/members"
```

---

### Task 8: `DELETE /api/lists/[id]/members/[userId]`

**Files:**
- Create: `app/api/lists/[id]/members/[userId]/route.ts`
- Modify: `tests/api/lists-members.test.ts` — append DELETE tests

**Interfaces:**
- Produces: `DELETE /api/lists/[id]/members/[userId]` → 200 | 400 | 401 | 403 | 404

- [ ] **Step 1: Add failing DELETE tests**

Append to `tests/api/lists-members.test.ts`:

```ts
import * as memberHandler from '@/app/api/lists/[id]/members/[userId]/route'

// Extend the existing prisma mock by adding `delete` to listMembership.
// Update the jest.mock block at top of file to include delete:
//   listMembership: { findUnique, findMany, delete }
// (Re-edit Step 1 mock block to add `delete: jest.fn()` — do that now if missing.)

describe('DELETE /api/lists/:id/members/:userId', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(401)
      },
    })
  })

  it('owner removes a member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.delete as jest.Mock).mockResolvedValue({})

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('member removes themselves (self-leave)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.delete as jest.Mock).mockResolvedValue({})

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('non-owner cannot remove another user', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm2' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(403)
      },
    })
  })

  it('owner cannot remove themselves', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'owner-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(400)
      },
    })
  })

  it('returns 404 when membership does not exist', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'ghost' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(404)
      },
    })
  })
})
```

Also update the prisma mock declaration at top of file:

```ts
jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}))
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest tests/api/lists-members.test.ts`
Expected: DELETE tests fail (handler missing).

- [ ] **Step 3: Implement handler**

Create `app/api/lists/[id]/members/[userId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await prisma.list.findUnique({ where: { id: params.id } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = list.ownerId === session.userId
  const isSelf = params.userId === session.userId

  if (isOwner && isSelf) {
    return NextResponse.json({ error: 'Owner cannot leave own list' }, { status: 400 })
  }
  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const membership = await prisma.listMembership.findUnique({
    where: { listId_userId: { listId: params.id, userId: params.userId } },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listMembership.delete({
    where: { listId_userId: { listId: params.id, userId: params.userId } },
  })
  return NextResponse.json({ data: null })
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx jest tests/api/lists-members.test.ts`
Expected: 9 tests pass (3 GET + 6 DELETE).

- [ ] **Step 5: Commit**

```bash
git add app/api/lists/[id]/members/[userId]/ tests/api/lists-members.test.ts
git commit -m "feat(api): DELETE /api/lists/[id]/members/[userId] with kick + self-leave"
```

---

### Task 9: Update `GET /api/lists` to include shared lists

**Files:**
- Modify: `app/api/lists/route.ts`
- Modify: `tests/api/lists.test.ts`

**Interfaces:**
- Produces: `GET /api/lists` returns `Array<{ id, name, createdAt, owner: { id, name }, isOwner, _count: { items } }>`, sorted by `createdAt desc`.

- [ ] **Step 1: Update / add failing tests**

In `tests/api/lists.test.ts`, expand the prisma mock declaration to include `listMembership.findMany`:

```ts
jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    listMembership: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))
```

Replace the existing GET test with two scenarios:

```ts
describe('GET /api/lists', () => {
  it('returns own lists with isOwner=true and shared lists with isOwner=false', async () => {
    mockGetSession.mockResolvedValue(fakeSession) // user-1
    mockList.findMany.mockResolvedValue([
      {
        id: 'list-1', name: 'Mine', ownerId: 'user-1',
        createdAt: new Date('2026-06-18T10:00:00Z'),
        owner: { id: 'user-1', name: 'Alice' },
        _count: { items: 2 },
      },
      {
        id: 'list-2', name: 'Shared', ownerId: 'owner-2',
        createdAt: new Date('2026-06-18T11:00:00Z'),
        owner: { id: 'owner-2', name: 'Bob' },
        _count: { items: 5 },
      },
    ] as any)

    await testApiHandler({
      appHandler: listsHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toHaveLength(2)
        const mine = body.data.find((l: any) => l.id === 'list-1')
        const shared = body.data.find((l: any) => l.id === 'list-2')
        expect(mine.isOwner).toBe(true)
        expect(mine.owner).toEqual({ id: 'user-1', name: 'Alice' })
        expect(shared.isOwner).toBe(false)
        expect(shared.owner).toEqual({ id: 'owner-2', name: 'Bob' })
      },
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: listsHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
      },
    })
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest tests/api/lists.test.ts -t 'GET /api/lists'`
Expected: shape mismatch (`isOwner` undefined, `owner` undefined).

- [ ] **Step 3: Update `app/api/lists/route.ts` GET handler**

Replace `GET` with:

```ts
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lists = await prisma.list.findMany({
    where: {
      OR: [
        { ownerId: session.userId },
        { memberships: { some: { userId: session.userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  })

  const data = lists.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    owner: l.owner,
    isOwner: l.ownerId === session.userId,
    _count: l._count,
  }))

  return NextResponse.json({ data })
}
```

- [ ] **Step 4: Run all tests — expect green**

Run: `npx jest`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/lists/route.ts tests/api/lists.test.ts
git commit -m "feat(api): GET /api/lists includes shared lists with isOwner + owner"
```

---

### Task 10: Login & Register handle `next` query param

**Files:**
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`

**Interfaces:**
- Behavior: after successful login/register, redirect to `next` if it starts with `/`, else `/`.

No unit tests for these UI files (per existing convention). Manual verification step is included.

- [ ] **Step 1: Update `app/(auth)/login/page.tsx`**

Replace contents with:

```tsx
'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function sanitizeNext(value: string | null): string {
  if (!value) return '/'
  return value.startsWith('/') ? value : '/'
}

export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  )
}

function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = sanitizeNext(searchParams.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        router.replace(next)
        return
      }

      if (res.status === 401) {
        setError('Неверный email или пароль')
        return
      }

      setError('Ошибка соединения')
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  const registerHref = next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="max-w-sm mx-auto w-full px-7 flex flex-col justify-center min-h-screen">
        <div className="mb-12">
          <h1 className="font-display font-black text-5xl text-brand tracking-tighter leading-none mb-1.5">
            Покупки
          </h1>
          <p className="text-sm text-muted">Ваши списки всегда под рукой.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
            <input
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-white rounded-xl py-4 text-[15px] font-semibold mt-4 disabled:opacity-60 transition-opacity"
          >
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <p className="text-center text-[13px] text-muted mt-5">
          Нет аккаунта?{' '}
          <Link href={registerHref} className="text-brand font-medium">
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/(auth)/register/page.tsx` similarly**

Replace contents with:

```tsx
'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function sanitizeNext(value: string | null): string {
  if (!value) return '/'
  return value.startsWith('/') ? value : '/'
}

export default function RegisterPageWrapper() {
  return (
    <Suspense>
      <RegisterPage />
    </Suspense>
  )
}

function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = sanitizeNext(searchParams.get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })

      if (res.status === 201) {
        router.replace(next)
        return
      }

      if (res.status === 409) {
        setError('Пользователь с таким email уже существует')
        return
      }

      if (res.status === 400) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? 'Ошибка регистрации')
        return
      }

      setError('Ошибка соединения')
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  const loginHref = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="max-w-sm mx-auto w-full px-7 flex flex-col justify-center min-h-screen">
        <div className="mb-12">
          <h1 className="font-display font-black text-5xl text-brand tracking-tighter leading-none mb-1.5">
            Покупки
          </h1>
          <p className="text-sm text-muted">Ваши списки всегда под рукой.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Имя"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
            <input
              type="password"
              placeholder="Пароль"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-white rounded-xl py-4 text-[15px] font-semibold mt-4 disabled:opacity-60 transition-opacity"
          >
            {loading ? 'Регистрируемся…' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-center text-[13px] text-muted mt-5">
          Уже есть аккаунт?{' '}
          <Link href={loginHref} className="text-brand font-medium">
            Войти
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run all tests**

Run: `npx jest`
Expected: green (no changes to tested code).

- [ ] **Step 5: Commit**

```bash
git add app/\(auth\)/login/page.tsx app/\(auth\)/register/page.tsx
git commit -m "feat(auth): honour ?next= redirect on login and register"
```

---

### Task 11: Invite acceptance page (RSC) at `/invite/[token]`

**Files:**
- Create: `app/invite/[token]/page.tsx`
- Create: `app/invite/[token]/InviteResult.tsx` (small client island for the "back home" button)

**Interfaces:**
- Behavior:
  - Unauthenticated → `redirect('/login?next=/invite/{token}')`
  - Authenticated → call accept logic; on success redirect to `/lists/{listId}`; on 404 / 410 render the corresponding error screen.

This is an RSC and calls prisma directly (matching the existing project pattern where API routes are server logic — no extra HTTP roundtrip is needed when the same server has direct DB access). We re-use the same accept-flow logic.

- [ ] **Step 1: Refactor accept logic into a shared function**

Extract logic from `app/api/invite/[token]/accept/route.ts` into a helper. Create `lib/invite-accept.ts`:

```ts
import { prisma } from '@/lib/prisma'

export type AcceptResult =
  | { ok: true; listId: string; listName: string }
  | { ok: false; reason: 'not_found' | 'expired' }

export async function acceptInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await prisma.listInvite.findUnique({
    where: { token },
    include: { list: true },
  })
  if (!invite) return { ok: false, reason: 'not_found' }
  if (invite.expiresAt <= new Date()) return { ok: false, reason: 'expired' }

  const isOwner = invite.list.ownerId === userId
  if (!isOwner) {
    await prisma.listMembership.upsert({
      where: { listId_userId: { listId: invite.listId, userId } },
      create: { listId: invite.listId, userId },
      update: {},
    })
  }

  return { ok: true, listId: invite.listId, listName: invite.list.name }
}
```

Update `app/api/invite/[token]/accept/route.ts` to use it:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { acceptInvite } from '@/lib/invite-accept'

export async function POST(_: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await acceptInvite(params.token, session.userId)
  if (!result.ok) {
    if (result.reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Expired' }, { status: 410 })
  }
  return NextResponse.json({
    data: { listId: result.listId, listName: result.listName },
  })
}
```

- [ ] **Step 2: Run accept tests — still green**

Run: `npx jest tests/api/invite.test.ts`
Expected: same 6 tests pass.

- [ ] **Step 3: Create `app/invite/[token]/InviteResult.tsx`**

```tsx
'use client'

import Link from 'next/link'

export function InviteError({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="max-w-sm mx-auto w-full px-7 flex flex-col justify-center min-h-screen text-center">
        <h1 className="font-display font-bold text-2xl text-text mb-3">{title}</h1>
        <p className="text-sm text-muted mb-8 leading-relaxed">{message}</p>
        <Link
          href="/"
          className="bg-brand text-white rounded-xl py-3.5 text-[15px] font-semibold"
        >
          На главную
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `app/invite/[token]/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { acceptInvite } from '@/lib/invite-accept'
import { InviteError } from './InviteResult'

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) {
    redirect(`/login?next=/invite/${encodeURIComponent(params.token)}`)
  }

  const result = await acceptInvite(params.token, session.userId)
  if (result.ok) {
    redirect(`/lists/${result.listId}`)
  }

  if (result.reason === 'expired') {
    return (
      <InviteError
        title="Срок действия ссылки истёк"
        message="Попросите владельца сгенерировать новую."
      />
    )
  }

  return (
    <InviteError
      title="Ссылка недействительна"
      message="Ссылка недействительна или список удалён."
    />
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run all tests**

Run: `npx jest`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add lib/invite-accept.ts app/api/invite/[token]/accept/route.ts app/invite/
git commit -m "feat(ui): /invite/[token] RSC page with login redirect and error states"
```

---

### Task 12: Dashboard UI — remove long-press, shared badge, 403 handler

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Behavior:
  - `fetchLists` now expects `owner` + `isOwner` on each list element; redirect to `/` on 403 (defensive — should not happen for `GET /api/lists`, but we add it for consistency).
  - `ListCard`: long-press handlers removed; only short-tap navigates. Shared lists show `«общий · от {owner.name}»` instead of items count.
  - `deleteList` and its mutation removed from this file (delete moves into list page in Task 14).

- [ ] **Step 1: Replace `app/page.tsx` with the updated version**

Replace contents with:

```tsx
'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface GroceryList {
  id: string
  name: string
  createdAt: string
  owner: { id: string; name: string }
  isOwner: boolean
  _count: { items: number }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pluralLists(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} список`
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} списка`
  return `${n} списков`
}

function pluralItems(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} позиция`
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} позиции`
  return `${n} позиций`
}

// ── API fetchers ─────────────────────────────────────────────────────────────

async function fetchLists(): Promise<GroceryList[]> {
  const res = await fetch('/api/lists')
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login'
      return []
    }
    throw new Error('Не удалось загрузить списки')
  }
  const json = await res.json()
  return json.data
}

async function createList(name: string): Promise<GroceryList> {
  const res = await fetch('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось создать список')
  }
  const json = await res.json()
  // POST returns list without owner/isOwner/_count — set sensible defaults for optimistic display
  const data = json.data
  return {
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    owner: { id: data.ownerId, name: '' },
    isOwner: true,
    _count: { items: 0 },
  }
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

// ── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-surface rounded-2xl border border-border px-4 py-4 flex items-center gap-3 animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-border rounded w-2/3" />
        <div className="h-3 bg-border rounded w-1/3" />
      </div>
      <div className="h-4 w-4 bg-border rounded" />
    </div>
  )
}

// ── Create modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  isPending: boolean
}

function CreateModal({ open, onClose, onSubmit, isPending }: CreateModalProps) {
  const [name, setName] = useState('')

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  function handleClose() {
    setName('')
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Новый список</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Название списка"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
              className="w-full rounded-xl border border-border px-4 py-3 text-[15px] text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-bg"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !name.trim()}
            className="w-full rounded-xl bg-brand text-white font-semibold text-[15px] py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
          >
            {isPending ? 'Создание…' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="w-full text-center text-sm text-muted py-1"
          >
            Отмена
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ListsDashboard() {
  const router = useRouter()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)

  const { data: lists, isLoading, isError } = useQuery<GroceryList[]>({
    queryKey: ['lists'],
    queryFn: fetchLists,
  })

  const createMutation = useMutation({
    mutationFn: createList,
    onMutate: async (name: string) => {
      await qc.cancelQueries({ queryKey: ['lists'] })
      const previous = qc.getQueryData<GroceryList[]>(['lists'])
      const optimistic: GroceryList = {
        id: `optimistic-${Date.now()}`,
        name,
        createdAt: new Date().toISOString(),
        owner: { id: 'me', name: '' },
        isOwner: true,
        _count: { items: 0 },
      }
      qc.setQueryData<GroceryList[]>(['lists'], (old = []) => [optimistic, ...old])
      return { previous }
    },
    onError: (_err, _name, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['lists'], ctx.previous)
      }
    },
    onSuccess: (newList) => {
      qc.setQueryData<GroceryList[]>(['lists'], (old = []) =>
        old.map((l) => (l.id.startsWith('optimistic-') ? newList : l)),
      )
      setModalOpen(false)
      router.push(`/lists/${newList.id}`)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      window.location.href = '/login'
    },
  })

  function handleCreate(name: string) {
    createMutation.mutate(name)
  }

  const count = lists?.length ?? 0

  return (
    <>
      <div className="min-h-screen bg-bg">
        <header className="px-5 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-brand tracking-tight">
              Мои списки
            </h1>
            {!isLoading && !isError && (
              <p className="text-sm text-muted mt-0.5">{pluralLists(count)}</p>
            )}
          </div>
          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="text-sm text-muted mt-1 disabled:opacity-50"
          >
            Выйти
          </button>
        </header>

        <main className="px-5 pb-28">
          {isLoading && (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {isError && (
            <p className="text-sm text-danger mt-4">Не удалось загрузить списки. Попробуйте снова.</p>
          )}

          {!isLoading && !isError && count === 0 && (
            <p className="text-sm text-muted mt-8 text-center leading-relaxed">
              У вас пока нет списков.{' '}Нажмите{' '}
              <span className="font-semibold text-brand">+</span> чтобы создать первый.
            </p>
          )}

          {!isLoading && !isError && count > 0 && (
            <div className="space-y-3">
              {lists!.map((list) => (
                <ListCard key={list.id} list={list} />
              ))}
            </div>
          )}
        </main>
      </div>

      <button
        onClick={() => setModalOpen(true)}
        aria-label="Создать список"
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <CreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
      />
    </>
  )
}

// ── List card sub-component ───────────────────────────────────────────────────

function ListCard({ list }: { list: GroceryList }) {
  const router = useRouter()

  function handleClick() {
    if (!list.id.startsWith('optimistic-')) {
      router.push(`/lists/${list.id}`)
    }
  }

  const subtitle = list.isOwner
    ? pluralItems(list._count.items)
    : `общий · от ${list.owner.name} · ${pluralItems(list._count.items)}`

  return (
    <button
      onClick={handleClick}
      disabled={list.id.startsWith('optimistic-')}
      className="w-full bg-surface rounded-2xl border border-border px-4 py-4 flex items-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60 text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] text-text truncate">{list.name}</p>
        <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>
      </div>
      <svg
        className="text-muted shrink-0"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}
```

Key changes from before:
- `GroceryList` type now requires `owner` + `isOwner`.
- `createList` synthesises owner/isOwner defaults because POST `/api/lists` doesn't yet return them; this is acceptable since the optimistic entry is replaced after invalidation.
- `router.push(/lists/${id})` no longer appends `?name=` — list page fetches its own name.
- `deleteList` mutation and long-press logic removed entirely from `ListCard`.

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`
Open `http://localhost:3000`. Verify dashboard renders without long-press behaviour; shared list (if any in DB) shows `«общий · от {имя}»` subtitle.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): dashboard shows shared lists; long-press delete removed"
```

---

### Task 13: List page — drop ?name=, fetch list meta, prep for menu

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx`

**Interfaces:**
- Behavior: page fetches `GET /api/lists/[id]` to get `name` and `isOwner`. Existing item-fetch flow unchanged structurally. Adds 403 handler that redirects to `/`. Adds state hooks for the menu (no menu UI yet; that's Task 14).

This task is preparatory — refactors data flow, no new menu UI. Keeps the page green.

- [ ] **Step 1: Update `app/(app)/lists/[id]/page.tsx`**

Replace the top imports section and the data-fetching layer; preserve the existing `ItemRow`, `SkeletonItem`, and item-mutation code. Apply these specific changes:

Replace:
```tsx
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState, Suspense } from 'react'
```
With:
```tsx
import { useParams, useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
```

Remove the `Suspense` wrapper and `ListDetailPageWrapper`. The default export becomes `ListDetailPage` directly:

Replace:
```tsx
export default function ListDetailPageWrapper() {
  return (
    <Suspense>
      <ListDetailPage />
    </Suspense>
  )
}

function ListDetailPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()

  const listId = params.id
  const listName = searchParams.get('name') ?? 'Список'
```
With:
```tsx
interface ListMeta {
  id: string
  name: string
  isOwner: boolean
  owner: { id: string; name: string }
}

async function fetchListMeta(listId: string): Promise<ListMeta> {
  const res = await fetch(`/api/lists/${listId}`)
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login'
      throw new Error('unauthorized')
    }
    if (res.status === 403 || res.status === 404) {
      window.location.href = '/'
      throw new Error('no-access')
    }
    throw new Error('Не удалось загрузить список')
  }
  const json = await res.json()
  return json.data
}

export default function ListDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const listId = params.id

  const { data: meta } = useQuery<ListMeta>({
    queryKey: ['list-meta', listId],
    queryFn: () => fetchListMeta(listId),
  })

  const listName = meta?.name ?? 'Список'
```

Update `fetchItems` to also handle 403 (redirects to `/`):
```ts
async function fetchItems(listId: string): Promise<ListItem[]> {
  const res = await fetch(`/api/lists/${listId}/items`)
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login'
      return []
    }
    if (res.status === 403 || res.status === 404) {
      window.location.href = '/'
      return []
    }
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось загрузить список')
  }
  const json = await res.json()
  return json.data
}
```

Similarly extend `addItem`, `toggleItem`, `deleteItem` — on 403 redirect to `/`:
```ts
function handleAccessLost(status: number) {
  if (status === 401) { window.location.href = '/login'; return true }
  if (status === 403 || status === 404) { window.location.href = '/'; return true }
  return false
}
```
Inside each of `addItem`, `toggleItem`, `deleteItem`, add `if (handleAccessLost(res.status)) throw new Error('lost')` immediately after `if (!res.ok)`.

Concretely, e.g. for `addItem`:
```ts
async function addItem(listId: string, name: string): Promise<ListItem> {
  const res = await fetch(`/api/lists/${listId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

Apply the same pattern to `toggleItem` and `deleteItem` (also dropping their 401 inline handling since `handleAccessLost` covers it).

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run tests**

Run: `npx jest`
Expected: green (no test file changes; existing tests unaffected).

- [ ] **Step 4: Manual smoke**

`npm run dev`. Navigate from dashboard to a list. Verify title appears (now fetched, not from URL). Verify items load.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/lists/\[id\]/page.tsx
git commit -m "feat(ui): fetch list meta in detail page; handle 403/404 by redirecting to dashboard"
```

---

### Task 14: Overflow menu + Rename + Delete + Leave

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx` — add overflow menu sheet, rename sheet, delete confirm, leave confirm

**Interfaces:**
- Behavior:
  - Three-dots button in header → bottom sheet with action buttons.
  - Owner sees: «Пригласить» (no-op for now; wired in Task 15), «Переименовать», «Удалить».
  - Member sees: «Выйти».

This task adds the menu and all owner/member actions **except** the Share sheet (Task 15 will wire that up).

- [ ] **Step 1: Add new fetchers and types**

Inside `app/(app)/lists/[id]/page.tsx`, near the other API fetchers add:

```ts
async function renameList(listId: string, name: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось переименовать')
  }
}

async function deleteList(listId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось удалить')
  }
}

async function leaveList(listId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/members/${userId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось выйти')
  }
}
```

Add to component state in `ListDetailPage`:

```tsx
const [menuOpen, setMenuOpen] = useState(false)
const [renameOpen, setRenameOpen] = useState(false)
```

Add mutations:

```tsx
const renameMutation = useMutation({
  mutationFn: (name: string) => renameList(listId, name),
  onSuccess: (_void, name) => {
    qc.setQueryData<ListMeta>(['list-meta', listId], (old) => (old ? { ...old, name } : old))
    qc.invalidateQueries({ queryKey: ['lists'] })
    setRenameOpen(false)
  },
})

const deleteListMutation = useMutation({
  mutationFn: () => deleteList(listId),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['lists'] })
    router.replace('/')
  },
})

const leaveMutation = useMutation({
  mutationFn: () => {
    // meta is guaranteed loaded by the time the menu opens for a member
    // but pass userId from session-derived /api/auth/me? We don't have that here.
    // Easier: the membership endpoint accepts only "self" for members anyway.
    // We need the current user id. Add a /api/auth/me fetch.
    throw new Error('see step 2')
  },
})
```

- [ ] **Step 2: Add a /api/auth/me fetcher**

`/api/auth/me` already returns `{ data: { id, email, name, createdAt } }` (see `app/api/auth/me/route.ts`). Add this fetcher near the others:

```ts
async function fetchMe(): Promise<{ id: string }> {
  const res = await fetch('/api/auth/me')
  if (!res.ok) throw new Error('Не удалось получить пользователя')
  const json = await res.json()
  return json.data
}
```

Add to the component:

```tsx
const { data: me } = useQuery<{ id: string }>({ queryKey: ['me'], queryFn: fetchMe })
```

Update `leaveMutation`:

```tsx
const leaveMutation = useMutation({
  mutationFn: () => {
    if (!me) throw new Error('no user')
    return leaveList(listId, me.id)
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['lists'] })
    router.replace('/')
  },
})
```

- [ ] **Step 3: Add menu button to header**

Replace the header JSX:

```tsx
<header className="bg-bg px-4 pt-5 pb-4 flex items-center gap-3 border-b border-border flex-shrink-0">
  <button
    onClick={() => router.push('/')}
    aria-label="Назад"
    className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-text"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>
  <h1 className="font-semibold text-[17px] text-text flex-1 truncate">{listName}</h1>
  {meta && (
    <button
      onClick={() => setMenuOpen(true)}
      aria-label="Меню"
      className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-text"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    </button>
  )}
</header>
```

- [ ] **Step 4: Add menu sheet, rename sheet, and handlers**

Inside the component (after the existing JSX, before final `</div>`), add:

```tsx
{/* Overflow menu sheet */}
{menuOpen && meta && (
  <div
    className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
    onClick={(e) => {
      if (e.target === e.currentTarget) setMenuOpen(false)
    }}
  >
    <div className="bg-surface rounded-t-2xl w-full max-w-lg p-2 pb-6">
      {meta.isOwner ? (
        <>
          <MenuButton
            label="Пригласить"
            onClick={() => {
              setMenuOpen(false)
              // wired in Task 15 — open Share sheet
            }}
          />
          <MenuButton
            label="Переименовать"
            onClick={() => {
              setMenuOpen(false)
              setRenameOpen(true)
            }}
          />
          <MenuButton
            label="Удалить"
            danger
            onClick={() => {
              if (confirm(`Удалить список «${meta.name}»?`)) {
                setMenuOpen(false)
                deleteListMutation.mutate()
              }
            }}
          />
        </>
      ) : (
        <MenuButton
          label="Выйти"
          danger
          onClick={() => {
            if (confirm(`Покинуть список «${meta.name}»?`)) {
              setMenuOpen(false)
              leaveMutation.mutate()
            }
          }}
        />
      )}
      <button
        type="button"
        onClick={() => setMenuOpen(false)}
        className="w-full text-center text-sm text-muted py-3 mt-1"
      >
        Отмена
      </button>
    </div>
  </div>
)}

{/* Rename sheet */}
{renameOpen && meta && (
  <RenameSheet
    initialName={meta.name}
    isPending={renameMutation.isPending}
    onClose={() => setRenameOpen(false)}
    onSubmit={(name) => renameMutation.mutate(name)}
  />
)}
```

Add the helper components at the bottom of the file:

```tsx
function MenuButton({
  label,
  onClick,
  danger = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? 'w-full text-left px-4 py-3.5 text-[15px] font-medium text-danger rounded-xl active:bg-bg'
          : 'w-full text-left px-4 py-3.5 text-[15px] font-medium text-text rounded-xl active:bg-bg'
      }
    >
      {label}
    </button>
  )
}

function RenameSheet({
  initialName,
  isPending,
  onClose,
  onSubmit,
}: {
  initialName: string
  isPending: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialName) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Переименовать</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={100}
            className="w-full rounded-xl border border-border px-4 py-3 text-[15px] text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-bg"
          />
          <button
            type="submit"
            disabled={isPending || !name.trim() || name.trim() === initialName}
            className="w-full rounded-xl bg-brand text-white font-semibold text-[15px] py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
          >
            {isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-center text-sm text-muted py-1"
          >
            Отмена
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify TypeScript + smoke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev`. Tap three-dots → menu appears. As owner: try Rename (works), Delete (confirms, deletes, returns to dashboard). As member (open another list you joined): try Leave.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/lists/\[id\]/page.tsx
git commit -m "feat(ui): overflow menu with Rename / Delete (owner) and Leave (member)"
```

---

### Task 15: Share sheet — link + members + remove member

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx`

**Interfaces:**
- Behavior: Share sheet opens from menu's «Пригласить» (owner only). Auto-fetches/UPSERTs invite link. Shows owner block + member list with remove (cross) buttons. Confirm before removing.

- [ ] **Step 1: Add fetchers, types, mutations**

Near the other fetchers in `app/(app)/lists/[id]/page.tsx`, add:

```ts
interface MemberInfo {
  id: string
  name: string
  joinedAt: string
}

interface MembersResponse {
  owner: { id: string; name: string }
  members: MemberInfo[]
}

interface InviteInfo {
  token: string
  expiresAt: string
}

async function fetchMembers(listId: string): Promise<MembersResponse> {
  const res = await fetch(`/api/lists/${listId}/members`)
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось загрузить участников')
  }
  const json = await res.json()
  return json.data
}

async function createInvite(listId: string): Promise<InviteInfo> {
  const res = await fetch(`/api/lists/${listId}/invite`, { method: 'POST' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось создать ссылку')
  }
  const json = await res.json()
  return json.data
}

async function removeMember(listId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/members/${userId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось удалить участника')
  }
}
```

Add state to the component:

```tsx
const [shareOpen, setShareOpen] = useState(false)
```

Change the «Пригласить» menu button onClick to:

```tsx
onClick={() => {
  setMenuOpen(false)
  setShareOpen(true)
}}
```

Render the sheet:

```tsx
{shareOpen && meta?.isOwner && (
  <ShareSheet
    listId={listId}
    onClose={() => setShareOpen(false)}
  />
)}
```

- [ ] **Step 2: Implement `ShareSheet` at the bottom of the file**

```tsx
function ShareSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

  const { data: invite, isLoading: inviteLoading } = useQuery({
    queryKey: ['invite', listId],
    queryFn: () => createInvite(listId),
    staleTime: Infinity,
  })

  const { data: members } = useQuery({
    queryKey: ['members', listId],
    queryFn: () => fetchMembers(listId),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(listId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', listId] }),
  })

  const inviteUrl = invite ? `${window.location.origin}/invite/${invite.token}` : ''
  const expiresText = invite
    ? new Date(invite.expiresAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  async function handleCopy() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: user can manually copy from the visible input
    }
  }

  function handleRemove(member: MemberInfo) {
    if (confirm(`Удалить ${member.name} из списка?`)) {
      removeMutation.mutate(member.id)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10 max-h-[90vh] overflow-y-auto">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Поделиться списком</h2>

        {/* Link section */}
        <div className="mb-6">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Ссылка
          </p>
          {inviteLoading ? (
            <div className="h-12 bg-bg rounded-xl animate-pulse" />
          ) : (
            <>
              <p className="text-xs text-muted mb-2">Действует до {expiresText}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-bg border border-border rounded-xl px-3 py-2.5 text-[13px] text-text outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold"
                >
                  {copied ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Members section */}
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Участники
          </p>
          {members ? (
            <div className="space-y-2">
              <div className="flex items-center bg-bg border border-border rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-text truncate">{members.owner.name}</p>
                  <p className="text-[11px] text-muted">владелец</p>
                </div>
              </div>
              {members.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center bg-bg border border-border rounded-xl px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-text truncate">{m.name}</p>
                    <p className="text-[11px] text-muted">
                      присоединился {new Date(m.joinedAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={removeMutation.isPending}
                    aria-label={`Удалить ${m.name}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-muted active:bg-border disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-12 bg-bg rounded-xl animate-pulse" />
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-center text-sm text-muted py-2"
        >
          Закрыть
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`. As an owner of a list:
1. Open list → menu (three dots) → «Пригласить».
2. Verify a link appears with format `http://localhost:3000/invite/<token>` and an «Действует до DD.MM HH:mm» line.
3. Click «Скопировать» → button text flashes to «Скопировано».
4. Open the invite URL in an incognito window → after login/register, you land on the list as a member.
5. Back in the original window, reopen Share sheet → new member appears in the list. Click the cross → confirm → member is removed.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/lists/\[id\]/page.tsx
git commit -m "feat(ui): share sheet with link copy and member management"
```

---

## Self-review notes

**Spec coverage check** (each spec section → task):

- Schema (ListMembership + ListInvite + relations + cascades) → Task 1
- Auth helpers `requireListAccess` / `requireListOwner` → Task 2
- Existing endpoints switch to helpers + items open to members → Task 3
- `GET /api/lists/[id]` → Task 4
- `POST /api/lists/[id]/invite` (UPSERT, 24h TTL) → Task 5
- `POST /api/invite/[token]/accept` (404 / 410 / owner short-circuit / idempotent) → Task 6
- `GET /api/lists/[id]/members` → Task 7
- `DELETE /api/lists/[id]/members/[userId]` (kick + self-leave + owner-can't-leave) → Task 8
- `GET /api/lists` shape (owner + isOwner + shared) → Task 9
- `?next=` param on login/register → Task 10
- `/invite/[token]` RSC page with error states → Task 11
- Dashboard: long-press removed + shared badge → Task 12
- List page: drop `?name=` + fetch meta + 403 handling → Task 13
- Overflow menu + Rename + Delete + Leave → Task 14
- Share sheet (link + members + remove) → Task 15

All spec items mapped.

**Placeholder scan**: no TBD / TODO / vague directions. Every code step has full code blocks.

**Type consistency**:
- `requireListAccess` returns `{ list, isOwner }` (Task 2) — consumed correctly in Task 3 routes via `'error' in check` discrimination.
- `acceptInvite` (Task 11) returns `{ ok: true; listId; listName } | { ok: false; reason: 'not_found' | 'expired' }` — RSC page and API route both consume identical fields.
- `GroceryList` interface (Task 12) and list-meta types (Tasks 13, 15) consistent.
- `MenuButton`, `RenameSheet`, `ShareSheet` props match call sites.
- Mock additions to prisma in Tasks 3, 4, 7, 8, 9 — each task's mock block explicitly lists the new methods it needs.

**Edge cases verified covered**:
- Owner accepts own invite — Task 6 test 4.
- Already-member accepts — Task 6 test 6.
- Owner removes self — Task 8 test 5 (400).
- Non-owner removes other — Task 8 test 4 (403).
- Expired invite — Task 6 test 3, Task 11 RSC error.
- Race on UPSERT — handled by `listInvite.upsert` with `listId` PK (no test, but transactional semantic).
- 403 redirect in fetchers — Task 13 introduces `handleAccessLost`, propagated to all mutation fetchers in Tasks 14 and 15.
