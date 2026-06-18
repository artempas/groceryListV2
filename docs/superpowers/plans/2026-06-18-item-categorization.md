# Item Categorization via OpenRouter Embeddings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically assign each grocery item to one of a fixed set of categories (via OpenRouter embeddings, at creation time on the server) and group unchecked items by category on the list page.

**Architecture:** A fixed category list lives in code; each category has a reference phrase whose embedding is precomputed once by a build script into a committed JSON file. On `POST /items` the server embeds the item name, picks the nearest category by cosine similarity above a threshold (else `null`), and stores it on `ListItem.category`. The client groups unchecked items by category in a fixed order. Any embedding failure degrades gracefully to `category = null`.

**Tech Stack:** Next.js 14 (App Router), Prisma 7 + Postgres, React Query, Jest + next-test-api-route-handler, OpenRouter embeddings API (OpenAI-compatible).

## Global Constraints

- Path alias: `@/*` maps to repo root (`tsconfig.json`). Use `@/lib/...` in app/test code.
- Tests live in `tests/`, named `*.test.ts(x)`, run with `npm test`. Mock `@/lib/prisma` and `@/lib/auth` with `jest.mock` (see `tests/api/items.test.ts`).
- Categorization MUST NEVER break item creation. Any error/timeout/low-confidence → `category = null`.
- Embedding endpoint: `https://openrouter.ai/api/v1/embeddings` (OpenAI-compatible).
- Env vars (exact names): `OPENROUTER_API_KEY` (required for real categorization), `OPENROUTER_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`), `CATEGORY_MATCH_THRESHOLD` (default `0.30`).
- `lib/categories.ts` MUST stay pure data (no `fs`, no `process.env`, no network) so the client page can import the category order from it.
- Display name of a category IS the stored value of `ListItem.category`.
- Commit messages end with the repo's trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- Create `lib/categories.ts` — `CATEGORIES` (ordered defs) + `CATEGORY_NAMES` (ordered names). Pure data.
- Create `lib/embeddings.ts` — `embed(text)` OpenRouter client.
- Create `scripts/build-category-embeddings.ts` — one-off generator of the vectors JSON.
- Create `lib/category-vectors.json` — generated; committed.
- Create `lib/categorize.ts` — `cosineSimilarity`, `pickCategory`, `getCategoryVectors`, `categorize`.
- Create `lib/group-items.ts` — `groupItemsByCategory` pure helper for the UI.
- Modify `prisma/schema.prisma` — add `category String?` to `ListItem`.
- Modify `app/api/lists/[id]/items/route.ts` — call `categorize` in `POST`.
- Modify `app/(app)/lists/[id]/page.tsx` — group unchecked items by category.
- Modify `README.md` — document env vars and the build script.
- Tests: `tests/lib/categorize.test.ts`, `tests/lib/embeddings.test.ts`, `tests/lib/group-items.test.ts`, and additions to `tests/api/items.test.ts`.

---

### Task 1: Category definitions (`lib/categories.ts`)

**Files:**
- Create: `lib/categories.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface CategoryDef { name: string; reference: string }`
  - `export const CATEGORIES: CategoryDef[]` — ordered; order defines UI group order.
  - `export const CATEGORY_NAMES: string[]` — `CATEGORIES.map(c => c.name)`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/categories.test.ts`:

```ts
import { CATEGORIES, CATEGORY_NAMES } from '@/lib/categories'

describe('CATEGORIES', () => {
  it('has at least 10 categories', () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(10)
  })

  it('every category has a non-empty name and reference phrase', () => {
    for (const c of CATEGORIES) {
      expect(c.name.trim().length).toBeGreaterThan(0)
      expect(c.reference.trim().length).toBeGreaterThan(0)
    }
  })

  it('category names are unique', () => {
    expect(new Set(CATEGORY_NAMES).size).toBe(CATEGORY_NAMES.length)
  })

  it('CATEGORY_NAMES matches CATEGORIES order', () => {
    expect(CATEGORY_NAMES).toEqual(CATEGORIES.map((c) => c.name))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/categories.test.ts`
Expected: FAIL — cannot find module `@/lib/categories`.

- [ ] **Step 3: Write the implementation**

Create `lib/categories.ts`:

```ts
export interface CategoryDef {
  /** Display name; also the stored value of ListItem.category. */
  name: string
  /** Reference phrase (example products) used to compute the category embedding. */
  reference: string
}

export const CATEGORIES: CategoryDef[] = [
  { name: 'Овощи и фрукты', reference: 'картофель, помидоры, огурцы, яблоки, бананы, зелень, лук, морковь' },
  { name: 'Молочное и яйца', reference: 'молоко, сыр, творог, йогурт, кефир, сметана, сливочное масло, яйца' },
  { name: 'Мясо и рыба', reference: 'курица, говядина, свинина, фарш, рыба, колбаса, сосиски' },
  { name: 'Бакалея', reference: 'крупа, рис, гречка, макароны, мука, сахар, соль, подсолнечное масло, консервы' },
  { name: 'Хлеб и выпечка', reference: 'хлеб, батон, булочки, лаваш, багет' },
  { name: 'Напитки', reference: 'вода, сок, чай, кофе, газировка, лимонад' },
  { name: 'Сладости и снеки', reference: 'шоколад, печенье, конфеты, чипсы, орехи, мармелад' },
  { name: 'Замороженное', reference: 'пельмени, мороженое, замороженные овощи, замороженная пицца' },
  { name: 'Бытовая химия и хозтовары', reference: 'моющее средство, стиральный порошок, губки, мусорные пакеты, фольга' },
  { name: 'Гигиена и уход', reference: 'мыло, шампунь, зубная паста, туалетная бумага, гель для душа' },
]

export const CATEGORY_NAMES: string[] = CATEGORIES.map((c) => c.name)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/categories.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/categories.ts tests/lib/categories.test.ts
git commit -m "feat: fixed grocery category definitions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: OpenRouter embeddings client (`lib/embeddings.ts`)

**Files:**
- Create: `lib/embeddings.ts`
- Modify: `README.md`
- Test: `tests/lib/embeddings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export async function embed(text: string): Promise<number[]>` — returns the embedding vector; throws on missing key or non-OK response.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/embeddings.test.ts`:

```ts
import { embed } from '@/lib/embeddings'

const realFetch = global.fetch

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENROUTER_EMBEDDING_MODEL
})

afterEach(() => {
  global.fetch = realFetch
})

describe('embed', () => {
  it('posts to the OpenRouter embeddings endpoint and returns the vector', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    const vector = await embed('молоко')

    expect(vector).toEqual([0.1, 0.2, 0.3])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('openai/text-embedding-3-small')
    expect(body.input).toBe('молоко')
  })

  it('uses OPENROUTER_EMBEDDING_MODEL when set', async () => {
    process.env.OPENROUTER_EMBEDDING_MODEL = 'cohere/embed-v3'
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    await embed('x')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('cohere/embed-v3')
  })

  it('throws when API key is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(embed('x')).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch
    await expect(embed('x')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/embeddings.test.ts`
Expected: FAIL — cannot find module `@/lib/embeddings`.

- [ ] **Step 3: Write the implementation**

Create `lib/embeddings.ts`:

```ts
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const DEFAULT_MODEL = 'openai/text-embedding-3-small'

/**
 * Returns the embedding vector for `text` via OpenRouter.
 * Throws if the API key is missing or the request fails.
 */
export async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

  const model = process.env.OPENROUTER_EMBEDDING_MODEL || DEFAULT_MODEL

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter embeddings failed: ${res.status} ${detail}`)
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] }
  const vector = json.data?.[0]?.embedding
  if (!vector) throw new Error('OpenRouter embeddings response had no vector')
  return vector
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/embeddings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Document env vars in README**

Append to `README.md`:

```markdown
## Категоризация товаров

Товары автоматически распределяются по категориям через эмбеддинги OpenRouter.

Переменные окружения:

- `OPENROUTER_API_KEY` — ключ OpenRouter (обязателен для категоризации).
- `OPENROUTER_EMBEDDING_MODEL` — модель эмбеддингов (по умолчанию `openai/text-embedding-3-small`).
- `CATEGORY_MATCH_THRESHOLD` — минимальная косинусная близость для присвоения категории (по умолчанию `0.30`).

Векторы категорий предвычислены в `lib/category-vectors.json`. Перегенерировать
после изменения списка категорий или модели:

\`\`\`bash
npx tsx scripts/build-category-embeddings.ts
\`\`\`
```

- [ ] **Step 6: Commit**

```bash
git add lib/embeddings.ts tests/lib/embeddings.test.ts README.md
git commit -m "feat: OpenRouter embeddings client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Build script + generated vectors (`scripts/build-category-embeddings.ts`, `lib/category-vectors.json`)

**Files:**
- Create: `scripts/build-category-embeddings.ts`
- Create (generated): `lib/category-vectors.json`

**Interfaces:**
- Consumes: `CATEGORIES` (Task 1), `embed` (Task 2).
- Produces: `lib/category-vectors.json` — `Array<{ name: string; vector: number[] }>`, same order as `CATEGORIES`.

This task has no unit test (one-off script). Its deliverable is a valid, committed JSON file. Requires `OPENROUTER_API_KEY` in the environment (or a `.env` file — the script loads `dotenv/config`).

- [ ] **Step 1: Write the script**

Create `scripts/build-category-embeddings.ts`:

```ts
import 'dotenv/config'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { CATEGORIES } from '../lib/categories'
import { embed } from '../lib/embeddings'

async function main() {
  const out: { name: string; vector: number[] }[] = []
  for (const category of CATEGORIES) {
    process.stdout.write(`Embedding "${category.name}"... `)
    const vector = await embed(category.reference)
    out.push({ name: category.name, vector })
    console.log(`ok (${vector.length} dims)`)
  }
  const target = join(__dirname, '..', 'lib', 'category-vectors.json')
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
  console.log(`Wrote ${out.length} vectors to ${target}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Run the script to generate vectors**

Ensure `OPENROUTER_API_KEY` is set (e.g. in `.env`), then run:
`npx tsx scripts/build-category-embeddings.ts`
Expected: one "ok (N dims)" line per category and a final "Wrote 10 vectors…" line. `lib/category-vectors.json` now exists.

- [ ] **Step 3: Verify the generated JSON shape**

Run: `node -e "const v=require('./lib/category-vectors.json'); console.log(v.length, Array.isArray(v[0].vector), typeof v[0].name)"`
Expected: `10 true string`

- [ ] **Step 4: Commit**

```bash
git add scripts/build-category-embeddings.ts lib/category-vectors.json
git commit -m "feat: build script and precomputed category vectors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Categorization logic (`lib/categorize.ts`)

**Files:**
- Create: `lib/categorize.ts`
- Test: `tests/lib/categorize.test.ts`

**Interfaces:**
- Consumes: `embed` (Task 2), `lib/category-vectors.json` (Task 3).
- Produces:
  - `export function cosineSimilarity(a: number[], b: number[]): number`
  - `export interface CategoryVector { name: string; vector: number[] }`
  - `export function getCategoryVectors(): CategoryVector[]`
  - `export function pickCategory(itemVector: number[], categories: CategoryVector[], threshold: number): string | null`
  - `export async function categorize(name: string, loadVectors?: () => CategoryVector[]): Promise<string | null>` — `loadVectors` defaults to `getCategoryVectors`; tests inject their own to avoid mocking the filesystem.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/categorize.test.ts`:

```ts
jest.mock('@/lib/embeddings', () => ({ embed: jest.fn() }))

import { cosineSimilarity, pickCategory, categorize } from '@/lib/categorize'
import { embed } from '@/lib/embeddings'

const mockEmbed = embed as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CATEGORY_MATCH_THRESHOLD
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})

describe('pickCategory', () => {
  const cats = [
    { name: 'A', vector: [1, 0] },
    { name: 'B', vector: [0, 1] },
  ]
  it('returns the nearest category above threshold', () => {
    expect(pickCategory([0.9, 0.1], cats, 0.3)).toBe('A')
  })
  it('returns null when best similarity is below threshold', () => {
    expect(pickCategory([1, 1], cats, 0.95)).toBeNull()
  })
  it('returns null when there are no categories', () => {
    expect(pickCategory([1, 0], [], 0.3)).toBeNull()
  })
})

describe('categorize', () => {
  const vectors = [
    { name: 'A', vector: [1, 0] },
    { name: 'B', vector: [0, 1] },
  ]

  it('returns the matched category name', async () => {
    mockEmbed.mockResolvedValue([1, 0])
    await expect(categorize('thing', () => vectors)).resolves.toBe('A')
  })

  it('returns null when embed throws (API error)', async () => {
    mockEmbed.mockRejectedValue(new Error('network'))
    await expect(categorize('thing', () => vectors)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/categorize.test.ts`
Expected: FAIL — cannot find module `@/lib/categorize`.

- [ ] **Step 3: Write the implementation**

Create `lib/categorize.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { embed } from '@/lib/embeddings'

export interface CategoryVector {
  name: string
  vector: number[]
}

const DEFAULT_THRESHOLD = 0.3

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

let cached: CategoryVector[] | null = null

/** Loads precomputed category vectors; returns [] if the file is missing/invalid. */
export function getCategoryVectors(): CategoryVector[] {
  if (cached) return cached
  try {
    const raw = readFileSync(join(process.cwd(), 'lib', 'category-vectors.json'), 'utf8')
    cached = JSON.parse(raw) as CategoryVector[]
  } catch {
    cached = []
  }
  return cached
}

export function pickCategory(
  itemVector: number[],
  categories: CategoryVector[],
  threshold: number,
): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const cat of categories) {
    const score = cosineSimilarity(itemVector, cat.vector)
    if (score > bestScore) {
      bestScore = score
      best = cat.name
    }
  }
  return bestScore >= threshold ? best : null
}

/**
 * Returns the category name for `name`, or null on any failure / low confidence.
 * Never throws — categorization must never break item creation.
 */
export async function categorize(
  name: string,
  loadVectors: () => CategoryVector[] = getCategoryVectors,
): Promise<string | null> {
  try {
    const threshold = process.env.CATEGORY_MATCH_THRESHOLD
      ? parseFloat(process.env.CATEGORY_MATCH_THRESHOLD)
      : DEFAULT_THRESHOLD
    const vector = await embed(name)
    return pickCategory(vector, loadVectors(), threshold)
  } catch {
    return null
  }
}
```

> Note: `loadVectors` defaults to `getCategoryVectors` (real JSON in production). Tests inject a fixture loader, avoiding filesystem mocking and same-module spy pitfalls. The route in Task 6 calls `categorize(trimmed)` with the default loader.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/categorize.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/categorize.ts tests/lib/categorize.test.ts
git commit -m "feat: embedding-based categorize() with graceful fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Prisma schema — add `category`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `ListItem.category: string | null` available on the Prisma client and in API responses.

Requires `DATABASE_URL` in the environment for `prisma migrate`.

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, in `model ListItem`, add the `category` line after `name`:

```prisma
model ListItem {
  id          String    @id @default(cuid())
  name        String
  category    String?
  list        List      @relation(fields: [listId], references: [id], onDelete: Cascade)
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_item_category`
Expected: a new migration under `prisma/migrations/…_add_item_category/` is created and applied; Prisma client regenerates.

- [ ] **Step 3: Verify the client has the field**

Run: `npx tsc --noEmit`
Expected: no errors (the generated client now includes `category`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add nullable category column to ListItem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire categorization into `POST /items`

**Files:**
- Modify: `app/api/lists/[id]/items/route.ts`
- Test: `tests/api/items.test.ts`

**Interfaces:**
- Consumes: `categorize` (Task 4), `ListItem.category` (Task 5).
- Produces: created items carry `category` (string or null) in the response.

- [ ] **Step 1: Write the failing tests**

In `tests/api/items.test.ts`, add the categorize mock next to the existing mocks (after the `jest.mock('@/lib/auth', …)` block):

```ts
jest.mock('@/lib/categorize', () => ({ categorize: jest.fn() }))
```

Add the import alongside the other imports:

```ts
import { categorize } from '@/lib/categorize'
const mockCategorize = categorize as jest.Mock
```

In the existing `describe('POST /api/lists/:id/items', …)` block, add these two tests after the current `it('creates an item', …)`:

```ts
  it('saves the category returned by categorize', async () => {
    mockCategorize.mockResolvedValue('Молочное и яйца')
    mockItem.create.mockResolvedValue({ ...item, category: 'Молочное и яйца' })

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
        expect(body.data.category).toBe('Молочное и яйца')
        expect(mockItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ category: 'Молочное и яйца' }),
          }),
        )
      },
    })
  })

  it('still creates the item when categorize rejects', async () => {
    mockCategorize.mockRejectedValue(new Error('boom'))
    mockItem.create.mockResolvedValue({ ...item, category: null })

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
        expect(mockItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ category: null }),
          }),
        )
      },
    })
  })
```

Also make the existing `it('creates an item', …)` deterministic by adding at its top:

```ts
    mockCategorize.mockResolvedValue(null)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/items.test.ts`
Expected: FAIL — `category` not saved / `mockCategorize` undefined behavior (route does not yet call categorize).

- [ ] **Step 3: Update the route**

In `app/api/lists/[id]/items/route.ts`, add the import at the top:

```ts
import { categorize } from '@/lib/categorize'
```

Replace the body of `POST` from the `const { name }` line through the `prisma.listItem.create` call with:

```ts
  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const trimmed = name.trim()
  const category = await categorize(trimmed).catch(() => null)

  const item = await prisma.listItem.create({
    data: { name: trimmed, category, listId: params.id, createdById: session.userId },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/items.test.ts`
Expected: PASS (all POST tests including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add app/api/lists/[id]/items/route.ts tests/api/items.test.ts
git commit -m "feat: categorize items on creation in POST /items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Grouping helper (`lib/group-items.ts`)

**Files:**
- Create: `lib/group-items.ts`
- Test: `tests/lib/group-items.test.ts`

**Interfaces:**
- Consumes: nothing (generic over item shape).
- Produces: `export function groupItemsByCategory<T extends { category: string | null }>(items: T[], order: string[]): Array<{ category: string | null; items: T[] }>` — groups in `order`; omits empty groups; the `null` group (label `category: null`) comes last only if it has items.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/group-items.test.ts`:

```ts
import { groupItemsByCategory } from '@/lib/group-items'

const order = ['A', 'B']

it('groups items by category in the given order', () => {
  const items = [
    { id: 1, category: 'B' },
    { id: 2, category: 'A' },
    { id: 3, category: 'A' },
  ]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['A', 'B'])
  expect(groups[0].items.map((i) => i.id)).toEqual([2, 3])
  expect(groups[1].items.map((i) => i.id)).toEqual([1])
})

it('omits categories with no items', () => {
  const items = [{ id: 1, category: 'B' }]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['B'])
})

it('puts null-category items in a trailing group', () => {
  const items = [
    { id: 1, category: null },
    { id: 2, category: 'A' },
  ]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['A', null])
})

it('preserves input order within a group', () => {
  const items = [
    { id: 1, category: 'A' },
    { id: 2, category: 'A' },
  ]
  expect(groupItemsByCategory(items, order)[0].items.map((i) => i.id)).toEqual([1, 2])
})

it('groups unknown categories (not in order) under null', () => {
  const items = [{ id: 1, category: 'Zzz' }]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual([null])
  expect(groups[0].items.map((i) => i.id)).toEqual([1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/group-items.test.ts`
Expected: FAIL — cannot find module `@/lib/group-items`.

- [ ] **Step 3: Write the implementation**

Create `lib/group-items.ts`:

```ts
export interface ItemGroup<T> {
  category: string | null
  items: T[]
}

/**
 * Groups items by their category in `order`. Empty categories are omitted.
 * Items whose category is null or not in `order` go into a trailing null group.
 */
export function groupItemsByCategory<T extends { category: string | null }>(
  items: T[],
  order: string[],
): ItemGroup<T>[] {
  const known = new Set(order)
  const buckets = new Map<string, T[]>()
  const leftover: T[] = []

  for (const item of items) {
    if (item.category && known.has(item.category)) {
      const bucket = buckets.get(item.category)
      if (bucket) bucket.push(item)
      else buckets.set(item.category, [item])
    } else {
      leftover.push(item)
    }
  }

  const groups: ItemGroup<T>[] = []
  for (const name of order) {
    const bucket = buckets.get(name)
    if (bucket && bucket.length > 0) groups.push({ category: name, items: bucket })
  }
  if (leftover.length > 0) groups.push({ category: null, items: leftover })
  return groups
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/group-items.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/group-items.ts tests/lib/group-items.test.ts
git commit -m "feat: groupItemsByCategory helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Render category groups on the list page

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx`

**Interfaces:**
- Consumes: `groupItemsByCategory` (Task 7), `CATEGORY_NAMES` (Task 1), `ListItem.category` from the API.
- Produces: unchecked items render grouped under category headers; checked items remain a single "Куплено (N)" block.

This task is a UI change verified visually (`npm run dev`) plus `npx tsc --noEmit`; the testable logic was covered in Task 7.

- [ ] **Step 1: Add `category` to the client `ListItem` type**

In `app/(app)/lists/[id]/page.tsx`, in the `interface ListItem` block, add the `category` field after `name`:

```ts
interface ListItem {
  id: string
  name: string
  category: string | null
  listId: string
  createdAt: string
  checkedAt: string | null
  createdBy: { id: string; name: string }
  checkedBy: { id: string; name: string } | null
}
```

- [ ] **Step 2: Import the grouping helper and category order**

Add near the top imports of `app/(app)/lists/[id]/page.tsx`:

```ts
import { groupItemsByCategory } from '@/lib/group-items'
import { CATEGORY_NAMES } from '@/lib/categories'
```

- [ ] **Step 3: Build groups from unchecked items**

In `ListDetailPage`, replace the line:

```ts
  const unchecked = items?.filter((i) => i.checkedAt === null) ?? []
```

with:

```ts
  const unchecked = items?.filter((i) => i.checkedAt === null) ?? []
  const uncheckedGroups = groupItemsByCategory(unchecked, CATEGORY_NAMES)
```

- [ ] **Step 4: Render grouped unchecked items**

In the render, replace the "Unchecked items" mapping block:

```tsx
            {/* Unchecked items */}
            {unchecked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
                isToggling={
                  toggleMutation.isPending &&
                  (toggleMutation.variables as { itemId: string } | undefined)?.itemId === item.id
                }
              />
            ))}
```

with grouped rendering (a header per category; `null` group labelled "Без категории"):

```tsx
            {/* Unchecked items grouped by category */}
            {uncheckedGroups.map((group) => (
              <div key={group.category ?? '__none__'} className="space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 py-2">
                  {group.category ?? 'Без категории'}
                </p>
                {group.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    isToggling={
                      toggleMutation.isPending &&
                      (toggleMutation.variables as { itemId: string } | undefined)?.itemId === item.id
                    }
                  />
                ))}
              </div>
            ))}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify visually**

Run: `npm run dev`, open a list, add items like «молоко», «бананы», «хлеб».
Expected: each appears under its category header; купленные items still collapse into the "Куплено (N)" block at the bottom. (Requires `OPENROUTER_API_KEY` and a generated `lib/category-vectors.json`; without them items appear under «Без категории».)

- [ ] **Step 7: Commit**

```bash
git add app/(app)/lists/[id]/page.tsx
git commit -m "feat(ui): group unchecked items by category

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — all green.
- [ ] Typecheck: `npx tsc --noEmit` — clean.
- [ ] Lint: `npm run lint` — clean.

## Self-Review notes (coverage against spec)

- Fixed category list → Task 1.
- OpenRouter embeddings client + env vars → Task 2.
- Precomputed category vectors + build script → Task 3.
- Cosine matching, threshold, graceful null fallback → Task 4.
- `category` persisted on ListItem → Task 5.
- Categorize at creation in POST /items; never breaks creation → Task 6.
- Grouped display in fixed order, null → "Без категории" trailing group; checked items unchanged → Tasks 7–8.
- Out of scope (no backfill, no pgvector, no caching, no dynamic categories) → respected; existing items surface under "Без категории".
