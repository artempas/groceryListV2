# Grocery List App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first PWA grocery list app with email/password auth, multiple lists per user, and per-item creation/check metadata.

**Architecture:** Next.js 14 App Router monorepo — API Routes serve the backend, React Server/Client Components serve the frontend. PostgreSQL + pgvector via Prisma ORM. JWT auth stored in httpOnly cookies. TanStack Query for client-side data fetching and optimistic updates.

**Tech Stack:** Next.js 14, TypeScript 5 (strict), Prisma 5, PostgreSQL 16 + pgvector, jose 5 (JWT), bcryptjs 2, TanStack Query v5, Tailwind CSS 3, Jest 29, next-test-api-route-handler 4, Docker Compose, Nginx. PWA: manual service worker + manifest (no external PWA library).

## Global Constraints

- Node.js ≥ 20
- TypeScript strict mode: `"strict": true`
- All API success responses: `{ data: T }`; all API error responses: `{ error: string }`
- Auth cookie name: `auth-token`, httpOnly, path `/`, sameSite `lax`, maxAge `604800` (7 days)
- JWT algorithm: HS256, signed with `jose`
- Passwords hashed with bcryptjs, salt rounds: `10`
- All DB ids: `cuid()`
- `checkedAt` and `checkedById` must always be set or cleared together atomically
- Path alias `@/` maps to project root

---

## File Map

```
groceryListV2/
├── app/
│   ├── layout.tsx                        root layout + PWA meta tags
│   ├── globals.css                       Tailwind base styles
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                    QueryClientProvider wrapper
│   │   ├── page.tsx                      lists dashboard
│   │   └── lists/[id]/page.tsx           list detail
│   └── api/
│       ├── auth/
│       │   ├── register/route.ts
│       │   ├── login/route.ts
│       │   ├── logout/route.ts
│       │   └── me/route.ts
│       └── lists/
│           ├── route.ts                  GET /api/lists, POST /api/lists
│           └── [id]/
│               ├── route.ts             PATCH /api/lists/:id, DELETE /api/lists/:id
│               └── items/
│                   ├── route.ts         GET /api/lists/:id/items, POST
│                   └── [itemId]/
│                       └── route.ts    PATCH /api/lists/:id/items/:itemId, DELETE
├── components/
│   ├── Providers.tsx                     QueryClientProvider (client component)
│   ├── lists/
│   │   ├── ListCard.tsx
│   │   └── CreateListDialog.tsx
│   └── items/
│       ├── ItemRow.tsx
│       └── AddItemInput.tsx
├── hooks/
│   ├── useLists.ts
│   └── useListItems.ts
├── lib/
│   ├── prisma.ts                         Prisma client singleton
│   └── auth.ts                           JWT sign/verify/getSession
├── middleware.ts                          route protection
├── prisma/
│   └── schema.prisma
├── public/
│   ├── manifest.json
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── tests/
│   ├── lib/auth.test.ts
│   ├── api/
│   │   ├── auth.test.ts
│   │   ├── lists.test.ts
│   │   └── items.test.ts
│   └── components/
│       ├── ItemRow.test.tsx
│       └── AddItemInput.test.tsx
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── jest.config.ts
├── jest.setup.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `jest.config.ts`
- Create: `jest.setup.ts`
- Create: `.env.example`
- Create: `app/globals.css`
- Create: `app/layout.tsx`

**Interfaces:**
- Produces: working `next dev`, `next build`, `jest` commands; `@/` path alias resolved

- [ ] **Step 1: Initialise Next.js project**

```bash
npx create-next-app@14 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

Expected output: project files created, `npm run dev` starts on port 3000.

- [ ] **Step 2: Install additional dependencies**

```bash
npm install \
  @prisma/client \
  bcryptjs \
  jose \
  @tanstack/react-query

npm install -D \
  prisma \
  @types/bcryptjs \
  jest \
  @types/jest \
  ts-jest \
  jest-environment-jsdom \
  next-test-api-route-handler \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `jest.config.ts`**

```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  testEnvironment: 'node',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
}

export default createJestConfig(config)
```

- [ ] **Step 5: Write `jest.setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 6: Write `.env.example`**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/grocerylist
JWT_SECRET=replace-with-at-least-32-random-chars
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 7: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Write `app/layout.tsx`**

```typescript
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Grocery List',
  description: 'Your personal grocery lists',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Grocery List',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 9: Verify dev server starts**

```bash
cp .env.example .env.local
npm run dev
```

Expected: server starts on http://localhost:3000 without errors.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json next.config.ts tailwind.config.ts \
        postcss.config.js jest.config.ts jest.setup.ts .env.example \
        app/globals.css app/layout.tsx
git commit -m "chore: project scaffold with Next.js 14, Tailwind, Jest"
```

---

### Task 2: Prisma Schema + Database

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/prisma.ts`

**Interfaces:**
- Produces: `prisma` export from `@/lib/prisma` — typed Prisma client

- [ ] **Step 1: Initialise Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

Expected: `prisma/schema.prisma` and `.env` created.

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  name         String
  createdAt    DateTime   @default(now())

  lists        List[]
  createdItems ListItem[] @relation("ItemCreatedBy")
  checkedItems ListItem[] @relation("ItemCheckedBy")
}

model List {
  id        String     @id @default(cuid())
  name      String
  owner     User       @relation(fields: [ownerId], references: [id])
  ownerId   String
  createdAt DateTime   @default(now())

  items     ListItem[]
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
```

- [ ] **Step 3: Write `lib/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Start PostgreSQL and run migration**

Ensure a PostgreSQL 16 instance is running locally (or via Docker):

```bash
docker run -d \
  --name grocery-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=grocerylist \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Update `.env.local` with the correct `DATABASE_URL`, then:

```bash
npx prisma migrate dev --name init
```

Expected: migration file created in `prisma/migrations/`, Prisma client generated.

- [ ] **Step 5: Verify client generates without errors**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/ lib/prisma.ts
git commit -m "feat: Prisma schema (User, List, ListItem) + pgvector DB"
```

---

### Task 3: Auth Utilities

**Files:**
- Create: `lib/auth.ts`
- Test: `tests/lib/auth.test.ts`

**Interfaces:**
- Produces:
  - `signToken(payload: { userId: string; email: string }): Promise<string>`
  - `verifyToken(token: string): Promise<{ userId: string; email: string }>`
  - `getSession(): Promise<{ userId: string; email: string } | null>`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/auth.test.ts
import { signToken, verifyToken } from '@/lib/auth'

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
})

describe('signToken / verifyToken', () => {
  it('round-trips a payload', async () => {
    const payload = { userId: 'user-1', email: 'a@b.com' }
    const token = await signToken(payload)
    const result = await verifyToken(token)
    expect(result.userId).toBe('user-1')
    expect(result.email).toBe('a@b.com')
  })

  it('throws on a tampered token', async () => {
    await expect(verifyToken('not.a.real.token')).rejects.toThrow()
  })

  it('token is a non-empty string', async () => {
    const token = await signToken({ userId: 'u', email: 'e@e.com' })
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/lib/auth.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 3: Write `lib/auth.ts`**

```typescript
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'auth-token'
const MAX_AGE = 60 * 60 * 24 * 7

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is not set')
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as { userId: string; email: string }
}

export async function getSession(): Promise<{ userId: string; email: string } | null> {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    maxAge: MAX_AGE,
    sameSite: 'lax' as const,
  }
}

export { COOKIE_NAME }
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest tests/lib/auth.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/lib/auth.test.ts
git commit -m "feat: JWT auth utilities (sign, verify, getSession)"
```

---

### Task 4: Auth API Routes

**Files:**
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/me/route.ts`
- Test: `tests/api/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`, `signToken`, `getSession`, `authCookieOptions`, `COOKIE_NAME` from `@/lib/auth`
- Produces: REST endpoints as specified in the design spec

- [ ] **Step 1: Write failing tests**

```typescript
// tests/api/auth.test.ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as registerHandler from '@/app/api/auth/register/route'
import * as loginHandler from '@/app/api/auth/login/route'
import * as meHandler from '@/app/api/auth/me/route'
import bcrypt from 'bcryptjs'
import { signToken } from '@/lib/auth'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
const mockPrisma = prisma as jest.Mocked<typeof prisma>

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('POST /api/auth/register', () => {
  it('creates a user and returns 201 with Set-Cookie', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: 'u1', name: 'Test', email: 'a@b.com', createdAt: new Date(),
    })

    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test', email: 'a@b.com', password: 'password123' }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.email).toBe('a@b.com')
        expect(res.headers.get('set-cookie')).toContain('auth-token')
      },
    })
  })

  it('returns 409 when email already exists', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' })

    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X', email: 'a@b.com', password: 'pass' }),
        })
        expect(res.status).toBe(409)
      },
    })
  })

  it('returns 400 when fields are missing', async () => {
    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com' }),
        })
        expect(res.status).toBe(400)
      },
    })
  })
})

describe('POST /api/auth/login', () => {
  it('returns 200 with Set-Cookie on valid credentials', async () => {
    const hash = await bcrypt.hash('secret', 10)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1', email: 'a@b.com', name: 'Test', createdAt: new Date(), passwordHash: hash,
    })

    await testApiHandler({
      appHandler: loginHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'secret' }),
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('set-cookie')).toContain('auth-token')
      },
    })
  })

  it('returns 401 on wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1', email: 'a@b.com', name: 'Test', createdAt: new Date(), passwordHash: hash,
    })

    await testApiHandler({
      appHandler: loginHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
        })
        expect(res.status).toBe(401)
      },
    })
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 without cookie', async () => {
    await testApiHandler({
      appHandler: meHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
      },
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/api/auth.test.ts
```

Expected: FAIL — route files not found.

- [ ] **Step 3: Write `app/api/auth/register/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken, authCookieOptions, COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, email, password } = body

  if (!name?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { name: name.trim(), email: email.trim(), passwordHash },
    select: { id: true, email: true, name: true, createdAt: true },
  })

  const token = await signToken({ userId: user.id, email: user.email })
  const response = NextResponse.json({ data: user }, { status: 201 })
  response.cookies.set(COOKIE_NAME, token, authCookieOptions())
  return response
}
```

- [ ] **Step 4: Write `app/api/auth/login/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken, authCookieOptions, COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()

  if (!email?.trim() || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await signToken({ userId: user.id, email: user.email })
  const response = NextResponse.json({
    data: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
  })
  response.cookies.set(COOKIE_NAME, token, authCookieOptions())
  return response
}
```

- [ ] **Step 5: Write `app/api/auth/logout/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { COOKIE_NAME } from '@/lib/auth'

export async function POST() {
  const response = NextResponse.json({ data: null })
  response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return response
}
```

- [ ] **Step 6: Write `app/api/auth/me/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({ data: user })
}
```

- [ ] **Step 7: Run tests — expect pass**

```bash
npx jest tests/api/auth.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add app/api/auth/ tests/api/auth.test.ts
git commit -m "feat: auth API routes (register, login, logout, me)"
```

---

### Task 5: Route Protection Middleware

**Files:**
- Create: `middleware.ts`

**Interfaces:**
- Consumes: `verifyToken` from `@/lib/auth`, `COOKIE_NAME` from `@/lib/auth`
- Produces: unauthenticated requests to `(app)` routes redirected to `/login`

- [ ] **Step 1: Write `middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { COOKIE_NAME } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    await verifyToken(token)
    return NextResponse.next()
  } catch {
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return response
  }
}

export const config = {
  matcher: ['/', '/lists/:path*'],
}
```

- [ ] **Step 2: Manually verify redirect works**

Start dev server (`npm run dev`), open http://localhost:3000 in browser — should redirect to `/login`.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: middleware — redirect unauthenticated users to /login"
```

---

### Task 6: Lists API Routes

**Files:**
- Create: `app/api/lists/route.ts`
- Create: `app/api/lists/[id]/route.ts`
- Test: `tests/api/lists.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`, `getSession` from `@/lib/auth`
- Produces:
  - `GET /api/lists` → `{ data: Array<List & { _count: { items: number } }> }`
  - `POST /api/lists` body `{ name: string }` → `{ data: List }` 201
  - `PATCH /api/lists/:id` body `{ name: string }` → `{ data: List }`
  - `DELETE /api/lists/:id` → `{ data: null }` 204

- [ ] **Step 1: Write failing tests**

```typescript
// tests/api/lists.test.ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as listsHandler from '@/app/api/lists/route'
import * as listHandler from '@/app/api/lists/[id]/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
const mockList = prisma.list as jest.Mocked<typeof prisma.list>

const fakeSession = { userId: 'user-1', email: 'a@b.com' }
const fakeList = { id: 'list-1', name: 'Groceries', ownerId: 'user-1', createdAt: new Date() }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('GET /api/lists', () => {
  it('returns lists for authenticated user', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockList.findMany.mockResolvedValue([{ ...fakeList, _count: { items: 2 } }])

    await testApiHandler({
      appHandler: listsHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toHaveLength(1)
        expect(body.data[0].name).toBe('Groceries')
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

describe('POST /api/lists', () => {
  it('creates a list and returns 201', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockList.create.mockResolvedValue(fakeList)

    await testApiHandler({
      appHandler: listsHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Groceries' }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.name).toBe('Groceries')
      },
    })
  })
})

describe('DELETE /api/lists/:id', () => {
  it('returns 403 when list belongs to another user', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockList.findUnique.mockResolvedValue({ ...fakeList, ownerId: 'other-user' })

    await testApiHandler({
      appHandler: listHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(403)
      },
    })
  })

  it('deletes own list and returns 200', async () => {
    mockGetSession.mockResolvedValue(fakeSession)
    mockList.findUnique.mockResolvedValue(fakeList)
    mockList.delete.mockResolvedValue(fakeList)

    await testApiHandler({
      appHandler: listHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/api/lists.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `app/api/lists/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lists = await prisma.list.findMany({
    where: { ownerId: session.userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  })

  return NextResponse.json({ data: lists })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const list = await prisma.list.create({
    data: { name: name.trim(), ownerId: session.userId },
  })

  return NextResponse.json({ data: list }, { status: 201 })
}
```

- [ ] **Step 4: Write `app/api/lists/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

async function requireOwnList(session: { userId: string }, id: string) {
  const list = await prisma.list.findUnique({ where: { id } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== session.userId) return { error: 'Forbidden', status: 403 }
  return { list }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireOwnList(session, params.id)
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

  const check = await requireOwnList(session, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  await prisma.list.delete({ where: { id: params.id } })
  return NextResponse.json({ data: null })
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx jest tests/api/lists.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/lists/ tests/api/lists.test.ts
git commit -m "feat: lists API routes (CRUD)"
```

---

### Task 7: Items API Routes

**Files:**
- Create: `app/api/lists/[id]/items/route.ts`
- Create: `app/api/lists/[id]/items/[itemId]/route.ts`
- Test: `tests/api/items.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getSession`
- Produces:
  - `GET /api/lists/:id/items` → `{ data: ListItem[] }` (unchecked first, then checked)
  - `POST /api/lists/:id/items` body `{ name }` → `{ data: ListItem }` 201
  - `PATCH /api/lists/:id/items/:itemId` body `{ checked: boolean }` → `{ data: ListItem }`
  - `DELETE /api/lists/:id/items/:itemId` → `{ data: null }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/api/items.test.ts
import { testApiHandler } from 'next-test-api-route-handler'
import * as itemsHandler from '@/app/api/lists/[id]/items/route'
import * as itemHandler from '@/app/api/lists/[id]/items/[itemId]/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
const mockList = prisma.list as jest.Mocked<typeof prisma.list>
const mockItem = prisma.listItem as jest.Mocked<typeof prisma.listItem>

const session = { userId: 'user-1', email: 'a@b.com' }
const list = { id: 'list-1', name: 'G', ownerId: 'user-1', createdAt: new Date() }
const item = {
  id: 'item-1', name: 'Milk', listId: 'list-1',
  createdById: 'user-1', createdAt: new Date(),
  checkedAt: null, checkedById: null,
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
  mockGetSession.mockResolvedValue(session)
  mockList.findUnique.mockResolvedValue(list)
})

describe('GET /api/lists/:id/items', () => {
  it('returns items', async () => {
    mockItem.findMany.mockResolvedValue([item])

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toHaveLength(1)
        expect(body.data[0].name).toBe('Milk')
      },
    })
  })
})

describe('POST /api/lists/:id/items', () => {
  it('creates an item', async () => {
    mockItem.create.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Milk' }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.name).toBe('Milk')
      },
    })
  })
})

describe('PATCH /api/lists/:id/items/:itemId — toggle check', () => {
  it('sets checkedAt and checkedById when checked=true', async () => {
    const checkedItem = { ...item, checkedAt: new Date(), checkedById: 'user-1' }
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.update.mockResolvedValue(checkedItem)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        const res = await fetch({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked: true }),
        })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.checkedById).toBe('user-1')
      },
    })
  })

  it('clears checkedAt and checkedById when checked=false', async () => {
    mockItem.findUnique.mockResolvedValue({ ...item, checkedAt: new Date(), checkedById: 'user-1' })
    mockItem.update.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        const res = await fetch({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked: false }),
        })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.checkedById).toBeNull()
      },
    })
  })
})

describe('DELETE /api/lists/:id/items/:itemId', () => {
  it('deletes an item', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.delete.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/api/items.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `app/api/lists/[id]/items/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

async function requireListAccess(userId: string, listId: string) {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== userId) return { error: 'Forbidden', status: 403 }
  return { list }
}

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

- [ ] **Step 4: Write `app/api/lists/[id]/items/[itemId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

async function requireItemAccess(userId: string, listId: string, itemId: string) {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== userId) return { error: 'Forbidden', status: 403 }

  const item = await prisma.listItem.findUnique({ where: { id: itemId } })
  if (!item || item.listId !== listId) return { error: 'Not found', status: 404 }
  return { item }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireItemAccess(session.userId, params.id, params.itemId)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

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
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireItemAccess(session.userId, params.id, params.itemId)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  await prisma.listItem.delete({ where: { id: params.itemId } })
  return NextResponse.json({ data: null })
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx jest tests/api/items.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Run all tests**

```bash
npx jest
```

Expected: PASS (all 14+ tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/lists/[id]/items/ tests/api/items.test.ts
git commit -m "feat: items API routes (CRUD + toggle check)"
```

---

### Task 8: Frontend Design Gate

**Files:** none — design decisions only

**Interfaces:**
- Produces: design tokens (colors, typography, spacing, component patterns) to apply in Tasks 9–11

- [ ] **Step 1: Invoke the frontend-design skill**

Before writing any frontend code, invoke the `frontend-design` skill in the current session:

```
/frontend-design
```

Follow the skill's instructions to establish:
- Color palette (primary, background, text, checked-item muted state)
- Typography (font family, sizes for headings, list items, metadata)
- Component patterns (card style, input style, button style, checkbox style)
- Any Tailwind custom config additions (e.g. custom colors, fonts)

- [ ] **Step 2: Apply design tokens to `tailwind.config.ts`**

Update `tailwind.config.ts` with any custom values determined by the frontend-design skill. Minimal example (replace with actual design output):

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Add tokens from frontend-design skill here
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 3: Commit design tokens**

```bash
git add tailwind.config.ts
git commit -m "design: apply frontend design tokens from design review"
```

---

### Task 9: Auth Pages

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/register/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login`, `POST /api/auth/register`
- Produces: functional login and register forms; successful auth redirects to `/`

- [ ] **Step 1: Write `app/(auth)/login/page.tsx`**

```typescript
'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
      }),
    })

    setLoading(false)
    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      const body = await res.json()
      setError(body.error ?? 'Login failed')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-xl py-3 font-medium disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          No account?{' '}
          <Link href="/register" className="underline">
            Register
          </Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Write `app/(auth)/register/page.tsx`**

```typescript
'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
      }),
    })

    setLoading(false)
    if (res.ok) {
      router.push('/')
      router.refresh()
    } else {
      const body = await res.json()
      setError(body.error ?? 'Registration failed')
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Create account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="name"
            type="text"
            required
            placeholder="Your name"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 chars)"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-xl py-3 font-medium disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          Have an account?{' '}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify in browser**

Open http://localhost:3000/login. Fill form with test credentials. Verify redirect to `/` after login.

- [ ] **Step 4: Commit**

```bash
git add app/\(auth\)/
git commit -m "feat: login and register pages"
```

---

### Task 10: Lists Dashboard

**Files:**
- Create: `components/Providers.tsx`
- Create: `app/(app)/layout.tsx`
- Create: `hooks/useLists.ts`
- Create: `components/lists/ListCard.tsx`
- Create: `components/lists/CreateListDialog.tsx`
- Create: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `GET /api/lists`, `POST /api/lists`, `DELETE /api/lists/:id`
- Produces: dashboard showing list cards, create-list dialog, delete list

- [ ] **Step 1: Write `components/Providers.tsx`**

```typescript
'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  }))
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
```

- [ ] **Step 2: Write `app/(app)/layout.tsx`**

```typescript
import { Providers } from '@/components/Providers'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
```

- [ ] **Step 3: Write `hooks/useLists.ts`**

```typescript
'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export type ListSummary = {
  id: string
  name: string
  ownerId: string
  createdAt: string
  _count: { items: number }
}

export function useLists() {
  return useQuery<ListSummary[]>({
    queryKey: ['lists'],
    queryFn: async () => {
      const res = await fetch('/api/lists')
      if (!res.ok) throw new Error('Failed to fetch lists')
      return (await res.json()).data
    },
  })
}

export function useCreateList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('Failed to create list')
      return (await res.json()).data as ListSummary
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  })
}

export function useDeleteList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lists/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete list')
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['lists'] })
      const previous = qc.getQueryData<ListSummary[]>(['lists'])
      qc.setQueryData<ListSummary[]>(['lists'], (old) => old?.filter((l) => l.id !== id))
      return { previous }
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(['lists'], context?.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  })
}
```

- [ ] **Step 4: Write `components/lists/ListCard.tsx`**

```typescript
'use client'
import Link from 'next/link'
import type { ListSummary } from '@/hooks/useLists'

type Props = {
  list: ListSummary
  onDelete: (id: string) => void
}

export function ListCard({ list, onDelete }: Props) {
  return (
    <div className="relative bg-white border rounded-2xl p-4 shadow-sm">
      <Link href={`/lists/${list.id}`} className="block">
        <p className="font-semibold text-lg truncate">{list.name}</p>
        <p className="text-sm text-gray-400 mt-1">{list._count.items} items</p>
      </Link>
      <button
        onClick={() => onDelete(list.id)}
        aria-label="Delete list"
        className="absolute top-3 right-3 text-gray-300 hover:text-red-500 text-xl leading-none"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Write `components/lists/CreateListDialog.tsx`**

```typescript
'use client'
import { useState, FormEvent } from 'react'

type Props = { onConfirm: (name: string) => void; onClose: () => void }

export function CreateListDialog({ onConfirm, onClose }: Props) {
  const [name, setName] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onConfirm(name.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">New list</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="List name"
            className="w-full border rounded-xl px-4 py-3 text-base"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border rounded-xl py-3 text-base"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-black text-white rounded-xl py-3 text-base disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Write `app/(app)/page.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLists, useCreateList, useDeleteList } from '@/hooks/useLists'
import { ListCard } from '@/components/lists/ListCard'
import { CreateListDialog } from '@/components/lists/CreateListDialog'

export default function HomePage() {
  const router = useRouter()
  const { data: lists, isLoading } = useLists()
  const createList = useCreateList()
  const deleteList = useDeleteList()
  const [showDialog, setShowDialog] = useState(false)

  async function handleCreate(name: string) {
    const list = await createList.mutateAsync(name)
    setShowDialog(false)
    router.push(`/lists/${list.id}`)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 bg-white border-b px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">My lists</h1>
        <button onClick={handleLogout} className="text-sm text-gray-500">
          Sign out
        </button>
      </header>

      <div className="p-4 space-y-3">
        {isLoading && <p className="text-gray-400 text-center py-8">Loading…</p>}
        {lists?.map((list) => (
          <ListCard
            key={list.id}
            list={list}
            onDelete={(id) => deleteList.mutate(id)}
          />
        ))}
        {!isLoading && lists?.length === 0 && (
          <p className="text-gray-400 text-center py-8">No lists yet. Create one!</p>
        )}
      </div>

      <button
        onClick={() => setShowDialog(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-black text-white rounded-full text-3xl shadow-lg flex items-center justify-center"
        aria-label="Create new list"
      >
        +
      </button>

      {showDialog && (
        <CreateListDialog
          onConfirm={handleCreate}
          onClose={() => setShowDialog(false)}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 7: Verify in browser**

Log in, verify lists dashboard loads, create a new list, verify it appears, delete it.

- [ ] **Step 8: Commit**

```bash
git add components/Providers.tsx app/\(app\)/layout.tsx hooks/useLists.ts \
        components/lists/ app/\(app\)/page.tsx
git commit -m "feat: lists dashboard with create/delete"
```

---

### Task 11: List Detail Page

**Files:**
- Create: `hooks/useListItems.ts`
- Create: `components/items/ItemRow.tsx`
- Create: `components/items/AddItemInput.tsx`
- Create: `app/(app)/lists/[id]/page.tsx`
- Test: `tests/components/ItemRow.test.tsx`
- Test: `tests/components/AddItemInput.test.tsx`

**Interfaces:**
- Consumes: `GET /api/lists/:id/items`, `POST`, `PATCH`, `DELETE`
- Produces: list page with optimistic check/uncheck, swipe-to-delete, sticky add-item input

- [ ] **Step 1: Write failing component tests**

```typescript
// tests/components/ItemRow.test.tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemRow } from '@/components/items/ItemRow'

const item = {
  id: 'i1',
  name: 'Milk',
  listId: 'l1',
  createdById: 'u1',
  createdAt: new Date().toISOString(),
  checkedAt: null,
  checkedById: null,
  createdBy: { id: 'u1', name: 'Alice' },
  checkedBy: null,
}

describe('ItemRow', () => {
  it('renders item name', () => {
    render(<ItemRow item={item} onToggle={jest.fn()} onDelete={jest.fn()} />)
    expect(screen.getByText('Milk')).toBeInTheDocument()
  })

  it('calls onToggle when checkbox clicked', () => {
    const onToggle = jest.fn()
    render(<ItemRow item={item} onToggle={onToggle} onDelete={jest.fn()} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggle).toHaveBeenCalledWith('i1', true)
  })

  it('shows checked state with strikethrough when checkedAt is set', () => {
    const checkedItem = { ...item, checkedAt: new Date().toISOString(), checkedById: 'u1', checkedBy: { id: 'u1', name: 'Alice' } }
    render(<ItemRow item={checkedItem} onToggle={jest.fn()} onDelete={jest.fn()} />)
    expect(screen.getByText('Milk')).toHaveClass('line-through')
  })
})
```

```typescript
// tests/components/AddItemInput.test.tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddItemInput } from '@/components/items/AddItemInput'

describe('AddItemInput', () => {
  it('calls onAdd with trimmed value on Enter', async () => {
    const onAdd = jest.fn()
    render(<AddItemInput onAdd={onAdd} loading={false} />)
    const input = screen.getByPlaceholderText('Add item…')
    await userEvent.type(input, 'Bread{Enter}')
    expect(onAdd).toHaveBeenCalledWith('Bread')
  })

  it('does not call onAdd for empty input', async () => {
    const onAdd = jest.fn()
    render(<AddItemInput onAdd={onAdd} loading={false} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Add item…'), { key: 'Enter' })
    expect(onAdd).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/components/
```

Expected: FAIL.

- [ ] **Step 3: Write `hooks/useListItems.ts`**

```typescript
'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export type ListItem = {
  id: string
  name: string
  listId: string
  createdById: string
  createdAt: string
  checkedAt: string | null
  checkedById: string | null
  createdBy: { id: string; name: string }
  checkedBy: { id: string; name: string } | null
}

export function useListItems(listId: string) {
  return useQuery<ListItem[]>({
    queryKey: ['lists', listId, 'items'],
    queryFn: async () => {
      const res = await fetch(`/api/lists/${listId}/items`)
      if (!res.ok) throw new Error('Failed to fetch items')
      return (await res.json()).data
    },
  })
}

export function useAddItem(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('Failed to add item')
      return (await res.json()).data as ListItem
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists', listId, 'items'] }),
  })
}

export function useToggleItem(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, checked }: { itemId: string; checked: boolean }) => {
      const res = await fetch(`/api/lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      })
      if (!res.ok) throw new Error('Failed to toggle item')
      return (await res.json()).data as ListItem
    },
    onMutate: async ({ itemId, checked }) => {
      await qc.cancelQueries({ queryKey: ['lists', listId, 'items'] })
      const previous = qc.getQueryData<ListItem[]>(['lists', listId, 'items'])
      qc.setQueryData<ListItem[]>(['lists', listId, 'items'], (old) =>
        old?.map((item) =>
          item.id === itemId
            ? { ...item, checkedAt: checked ? new Date().toISOString() : null, checkedById: checked ? 'optimistic' : null, checkedBy: null }
            : item
        )
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      qc.setQueryData(['lists', listId, 'items'], context?.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['lists', listId, 'items'] }),
  })
}

export function useDeleteItem(listId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete item')
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: ['lists', listId, 'items'] })
      const previous = qc.getQueryData<ListItem[]>(['lists', listId, 'items'])
      qc.setQueryData<ListItem[]>(['lists', listId, 'items'], (old) =>
        old?.filter((item) => item.id !== itemId)
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(['lists', listId, 'items'], context?.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['lists', listId, 'items'] }),
  })
}
```

- [ ] **Step 4: Write `components/items/ItemRow.tsx`**

```typescript
'use client'
import { useRef, useState } from 'react'
import type { ListItem } from '@/hooks/useListItems'

type Props = {
  item: ListItem
  onToggle: (id: string, checked: boolean) => void
  onDelete: (id: string) => void
}

export function ItemRow({ item, onToggle, onDelete }: Props) {
  const isChecked = item.checkedAt !== null
  const startX = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  const SWIPE_THRESHOLD = 80

  function handleTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return
    const delta = startX.current - e.touches[0].clientX
    if (delta > 0) setOffset(Math.min(delta, SWIPE_THRESHOLD + 20))
  }

  function handleTouchEnd() {
    if (offset >= SWIPE_THRESHOLD) {
      onDelete(item.id)
    }
    setOffset(0)
    startX.current = null
  }

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div
        className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center text-white text-sm font-medium"
        aria-hidden
      >
        Delete
      </div>
      <div
        className="relative bg-white flex items-center gap-3 px-4 py-3 transition-transform"
        style={{ transform: `translateX(-${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(item.id, !isChecked)}
          className="w-5 h-5 rounded accent-black flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className={`text-base truncate ${isChecked ? 'line-through text-gray-400' : ''}`}>
            {item.name}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Added by {item.createdBy.name}
            {item.checkedBy && ` · Checked by ${item.checkedBy.name}`}
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Write `components/items/AddItemInput.tsx`**

```typescript
'use client'
import { useState, KeyboardEvent } from 'react'

type Props = {
  onAdd: (name: string) => void
  loading: boolean
}

export function AddItemInput({ onAdd, loading }: Props) {
  const [value, setValue] = useState('')

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && value.trim()) {
      onAdd(value.trim())
      setValue('')
    }
  }

  return (
    <div className="sticky bottom-0 bg-white border-t px-4 py-3">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add item…"
        disabled={loading}
        className="w-full border rounded-xl px-4 py-3 text-base disabled:opacity-50"
      />
    </div>
  )
}
```

- [ ] **Step 6: Write `app/(app)/lists/[id]/page.tsx`**

```typescript
'use client'
import { useRouter } from 'next/navigation'
import { useListItems, useAddItem, useToggleItem, useDeleteItem } from '@/hooks/useListItems'
import { ItemRow } from '@/components/items/ItemRow'
import { AddItemInput } from '@/components/items/AddItemInput'

export default function ListPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { data: items, isLoading } = useListItems(params.id)
  const addItem = useAddItem(params.id)
  const toggleItem = useToggleItem(params.id)
  const deleteItem = useDeleteItem(params.id)

  const unchecked = items?.filter((i) => !i.checkedAt) ?? []
  const checked = items?.filter((i) => i.checkedAt) ?? []

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 bg-white border-b px-4 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-xl" aria-label="Back">
          ←
        </button>
        <h1 className="text-xl font-bold flex-1 truncate">List</h1>
      </header>

      <div className="p-4 space-y-2">
        {isLoading && <p className="text-gray-400 text-center py-8">Loading…</p>}
        {unchecked.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            onToggle={(id, checked) => toggleItem.mutate({ itemId: id, checked })}
            onDelete={(id) => deleteItem.mutate(id)}
          />
        ))}
        {checked.length > 0 && (
          <>
            <p className="text-xs text-gray-400 uppercase tracking-wide pt-2 px-1">
              Checked ({checked.length})
            </p>
            {checked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={(id, c) => toggleItem.mutate({ itemId: id, checked: c })}
                onDelete={(id) => deleteItem.mutate(id)}
              />
            ))}
          </>
        )}
      </div>

      <AddItemInput
        onAdd={(name: string) => addItem.mutate(name)}
        loading={addItem.isPending}
      />
    </main>
  )
}
```

- [ ] **Step 7: Run component tests — expect pass**

```bash
npx jest tests/components/
```

Expected: PASS (5 tests).

- [ ] **Step 8: Verify in browser**

Navigate to a list. Add items. Check/uncheck. Swipe to delete.

- [ ] **Step 9: Commit**

```bash
git add hooks/useListItems.ts components/items/ app/\(app\)/lists/ \
        tests/components/
git commit -m "feat: list detail page with items, toggle, swipe-delete"
```

---

### Task 12: PWA Configuration

**Files:**
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Create: `public/icons/icon-192.png` (placeholder)
- Create: `public/icons/icon-512.png` (placeholder)
- Modify: `app/layout.tsx` — add SW registration script

**Interfaces:**
- Produces: app installable as PWA on Android/iOS; offline static assets cached by service worker (no external PWA library — manual `sw.js` + `manifest.json`)

- [ ] **Step 1: Write `public/manifest.json`**

```json
{
  "name": "Grocery List",
  "short_name": "Groceries",
  "description": "Your personal grocery lists",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 2: Write `public/sw.js`**

A minimal service worker: caches Next.js static assets, skips API routes.

```javascript
const CACHE_NAME = 'grocery-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/api/')) return

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.url.includes('/_next/static/')) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
    })
  )
})
```

- [ ] **Step 3: Register service worker in `app/layout.tsx`**

Add `next/script` import and a registration script to the existing root layout. The layout already has PWA meta tags from Task 1 — add `Script` inside `<body>`:

```typescript
import Script from 'next/script'

// Inside RootLayout, in <body> before {children}:
<Script
  id="sw-register"
  strategy="afterInteractive"
  dangerouslySetInnerHTML={{
    __html: `if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js') }`,
  }}
/>
```

- [ ] **Step 4: Generate placeholder icons**

```bash
# Requires ImageMagick
convert -size 192x192 xc:'#000000' \
  -fill white -font DejaVu-Sans -pointsize 80 \
  -gravity center -annotate 0 "G" \
  public/icons/icon-192.png

convert -size 512x512 xc:'#000000' \
  -fill white -font DejaVu-Sans -pointsize 200 \
  -gravity center -annotate 0 "G" \
  public/icons/icon-512.png
```

If ImageMagick is unavailable, create two PNG files of the correct sizes using any tool and place them at `public/icons/icon-192.png` and `public/icons/icon-512.png`.

- [ ] **Step 5: Build production and verify manifest**

```bash
npm run build && npm start
```

Open http://localhost:3000 in Chrome DevTools → Application → Manifest. Verify icons and display mode show correctly. Check Application → Service Workers to confirm `sw.js` is registered.

- [ ] **Step 6: Commit**

```bash
git add public/manifest.json public/sw.js public/icons/ app/layout.tsx
git commit -m "feat: PWA — manual service worker, manifest, icons"
```

---

### Task 13: Docker + Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `nginx.conf`
- Create: `.dockerignore`

**Interfaces:**
- Produces: `docker compose up` starts the full app stack (Next.js + PostgreSQL + Nginx) on port 80/443

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.next
.git
.env
.env.local
npm-debug.log
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Enable standalone output in `next.config.ts`**

Add `output: 'standalone'` to the Next.js config:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
}
```

- [ ] **Step 4: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: grocerylist
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/grocerylist
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    command: >
      sh -c "npx prisma migrate deploy && node server.js"

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - app

volumes:
  pgdata:
```

- [ ] **Step 5: Write `nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;

    # Redirect HTTP to HTTPS in production
    # return 301 https://$host$request_uri;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

- [ ] **Step 6: Verify Docker build locally**

```bash
docker compose build
```

Expected: build completes without errors.

- [ ] **Step 7: Run full stack locally with Docker**

```bash
# Create a .env file for Docker Compose
echo "POSTGRES_PASSWORD=localpass\nJWT_SECRET=local-secret-at-least-32-chars-long!!" > .env

docker compose up
```

Open http://localhost and verify the app loads, register/login works, lists and items work end-to-end.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile docker-compose.yml nginx.conf .dockerignore
git commit -m "feat: Docker Compose deployment config (Next.js + PostgreSQL + Nginx)"
```

---

## Test Coverage Summary

| Area | Tests | Command |
|------|-------|---------|
| JWT utilities | 3 | `npx jest tests/lib/` |
| Auth API | 6 | `npx jest tests/api/auth.test.ts` |
| Lists API | 5 | `npx jest tests/api/lists.test.ts` |
| Items API | 5 | `npx jest tests/api/items.test.ts` |
| ItemRow component | 3 | `npx jest tests/components/ItemRow` |
| AddItemInput component | 2 | `npx jest tests/components/AddItemInput` |
| **Total** | **24** | `npx jest` |

Run all tests: `npx jest --coverage`
