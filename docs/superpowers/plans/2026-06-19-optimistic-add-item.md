# Optimistic Add-Item UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a newly added grocery item appear in the list instantly (optimistic UI), then reconcile with the server row that carries the LLM-assigned category.

**Architecture:** Convert the existing `addMutation` in the list-detail page from "insert on success" to the optimistic `onMutate` → `onSuccess`/`onError` pattern already used by `toggleMutation` and `deleteMutation`. A temporary row with `pending: true` is inserted immediately in the "Без категории" group with a "Определяем категорию…" spinner; when the POST resolves it is replaced by the real categorized row. Frontend-only — the API and `categorize()` are untouched.

**Tech Stack:** Next.js 14 (App Router, client component), React 18, `@tanstack/react-query` v5, framer-motion, Tailwind. Tests: Jest + `@testing-library/react` + `@testing-library/user-event`, jsdom environment per-file.

## Global Constraints

- All production changes are confined to `app/(app)/lists/[id]/page.tsx`. No API, Prisma, or `lib/` changes.
- UI copy is Russian, matching the existing file (e.g. placeholder `Добавить позицию…`, button aria-label `Добавить`).
- Follow the existing React Query optimistic pattern in the same file (snapshot `previous`, return it in context, roll back in `onError`).
- The temp row's `id` is `` `temp-${crypto.randomUUID()}` `` and must never be sent to the server (toggle/delete disabled while `pending`).
- New test files use `/** @jest-environment jsdom */` at the top (global jest env is `node`).

---

### Task 1: Optimistic insertion + reconciliation (happy path)

Insert the row immediately on submit with a categorizing indicator, then replace it with the server row when the POST resolves.

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx`
  - `ListItem` interface (~lines 12-21): add `pending?` field
  - `fetchMe` (~lines 167-172): widen return type
  - `ItemRow` component (~lines 183-288): pending indicator + disabled interactions
  - `me` query (~line 350): widen generic type
  - `addMutation` (~lines 361-370): rewrite to optimistic onMutate/onSuccess
  - submit button `disabled` (~line 615): drop `addMutation.isPending`
- Test: `tests/components/list-detail-add.test.tsx` (create)

**Interfaces:**
- Consumes: existing `addItem(listId, name): Promise<ListItem>`, `fetchItems`, `fetchListMeta`, `fetchMe`, `qc` (QueryClient), the `['items', listId]` cache shape (`ListItem[]`).
- Produces: optimistic `ListItem` carrying `pending: true`, replaced in cache by the real item keyed on the `tempId` stored in mutation context.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/list-detail-add.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ListDetailPage from '@/app/(app)/lists/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'list-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

// A manually-resolvable promise so we can assert UI state while the POST is in flight.
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> }

function jsonOk(data: unknown): FetchResult {
  return { ok: true, status: 200, json: async () => ({ data }) }
}

const listMeta = {
  id: 'list-1',
  name: 'Покупки',
  isOwner: true,
  owner: { id: 'u1', name: 'Аня' },
}
const me = { id: 'u1', name: 'Аня' }

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ListDetailPage />
    </QueryClientProvider>,
  )
}

let postDeferred: ReturnType<typeof deferred<FetchResult>>

beforeEach(() => {
  postDeferred = deferred<FetchResult>()
  global.fetch = jest.fn((input: RequestInfo | URL, opts?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = opts?.method ?? 'GET'
    if (url === '/api/auth/me') return Promise.resolve(jsonOk(me))
    if (url === '/api/lists/list-1' && method === 'GET') return Promise.resolve(jsonOk(listMeta))
    if (url === '/api/lists/list-1/items' && method === 'GET') return Promise.resolve(jsonOk([]))
    if (url === '/api/lists/list-1/items' && method === 'POST') return postDeferred.promise
    return Promise.resolve(jsonOk([]))
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

test('item appears instantly with a categorizing indicator, then reconciles', async () => {
  const user = userEvent.setup()
  renderPage()

  const input = await screen.findByPlaceholderText('Добавить позицию…')
  await user.type(input, 'Молоко')
  await user.click(screen.getByLabelText('Добавить'))

  // Optimistic row is present BEFORE the POST resolves, showing the indicator.
  expect(await screen.findByText('Молоко')).toBeInTheDocument()
  expect(screen.getByText('Определяем категорию…')).toBeInTheDocument()
  // Input was cleared on submit.
  expect(input).toHaveValue('')

  // Server responds with the categorized row.
  postDeferred.resolve(
    jsonOk({
      id: 'real-1',
      name: 'Молоко',
      category: 'Молочные продукты',
      listId: 'list-1',
      createdAt: new Date().toISOString(),
      checkedAt: null,
      createdBy: { id: 'u1', name: 'Аня' },
      checkedBy: null,
    }),
  )

  // Indicator disappears once reconciled; the item remains.
  await waitFor(() =>
    expect(screen.queryByText('Определяем категорию…')).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Молоко')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/components/list-detail-add.test.tsx -t "reconciles"`
Expected: FAIL — current `addMutation` only inserts in `onSuccess`, so "Молоко" is not in the document before the POST resolves (the `findByText('Молоко')` assertion times out), and there is no "Определяем категорию…" text.

- [ ] **Step 3: Add `pending` to the `ListItem` type and widen `fetchMe`**

In `app/(app)/lists/[id]/page.tsx`, add the `pending` field to the `ListItem` interface (the block starting at line 12):

```tsx
interface ListItem {
  id: string
  name: string
  category: string | null
  listId: string
  createdAt: string
  checkedAt: string | null
  createdBy: { id: string; name: string }
  checkedBy: { id: string; name: string } | null
  pending?: boolean
}
```

Widen `fetchMe`'s return type (line ~167) so the `me` query can expose `name`:

```tsx
async function fetchMe(): Promise<{ id: string; name: string }> {
  const res = await fetch('/api/auth/me')
  if (!res.ok) throw new Error('Не удалось получить пользователя')
  const json = await res.json()
  return json.data
}
```

- [ ] **Step 4: Widen the `me` query generic**

Change the `me` query declaration (line ~350) from `useQuery<{ id: string }>` to:

```tsx
  const { data: me } = useQuery<{ id: string; name: string }>({ queryKey: ['me'], queryFn: fetchMe })
```

- [ ] **Step 5: Rewrite `addMutation` to be optimistic**

Replace the entire `addMutation` block (lines ~361-370):

```tsx
  const addMutation = useMutation({
    mutationFn: (name: string) => addItem(listId, name),
    onMutate: async (name: string) => {
      await qc.cancelQueries({ queryKey: ['items', listId] })
      const previous = qc.getQueryData<ListItem[]>(['items', listId])
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: ListItem = {
        id: tempId,
        name,
        category: null,
        listId,
        createdAt: new Date().toISOString(),
        checkedAt: null,
        createdBy: { id: me?.id ?? '', name: me?.name ?? 'Вы' },
        checkedBy: null,
        pending: true,
      }
      qc.setQueryData<ListItem[]>(['items', listId], (old = []) => [optimistic, ...old])
      return { previous, tempId }
    },
    onSuccess: (newItem, _name, ctx) => {
      qc.setQueryData<ListItem[]>(['items', listId], (old = []) =>
        old.map((item) => (item.id === ctx?.tempId ? newItem : item)),
      )
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })
```

(Note: no `['items', listId]` refetch — that would drop other concurrent in-flight temp rows. `onError` is added in Task 2.)

- [ ] **Step 6: Render the pending indicator and disable interactions in `ItemRow`**

In `ItemRow`, after `const isChecked = item.checkedAt !== null` (line ~184), add:

```tsx
  const pending = item.pending === true
```

Guard the three touch handlers so a pending row cannot be swiped. Add this as the first line of `handleTouchStart`, `handleTouchMove`, and `handleTouchEnd` respectively:

```tsx
    if (pending) return
```

Disable the checkbox button (line ~251) by changing its `disabled` prop:

```tsx
          disabled={isToggling || pending}
```

Replace the meta paragraph (line ~283 `<p className="text-[11px] text-muted mt-0.5">{meta}</p>`) with a conditional:

```tsx
          {pending ? (
            <p className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border-2 border-border border-t-brand animate-spin inline-block" />
              Определяем категорию…
            </p>
          ) : (
            <p className="text-[11px] text-muted mt-0.5">{meta}</p>
          )}
```

- [ ] **Step 7: Let the user queue multiple adds**

Change the submit button's `disabled` (line ~615) to drop `addMutation.isPending`:

```tsx
            disabled={!inputValue.trim()}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest tests/components/list-detail-add.test.tsx -t "reconciles"`
Expected: PASS

- [ ] **Step 9: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add app/(app)/lists/[id]/page.tsx tests/components/list-detail-add.test.tsx
git commit -m "feat(ui): optimistic add-item with categorizing indicator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Error rollback + input restore

If the POST fails, remove the optimistic row and restore the user's text so it isn't lost.

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx` — add `onError` to `addMutation` (the block edited in Task 1)
- Test: `tests/components/list-detail-add.test.tsx` (add a second test)

**Interfaces:**
- Consumes: the `{ previous, tempId }` context returned by `onMutate` (Task 1); the `setInputValue` state setter and `inputValue` already in the component.
- Produces: no new exports.

- [ ] **Step 1: Write the failing error-path test**

Append to `tests/components/list-detail-add.test.tsx`:

```tsx
test('failed add removes the optimistic row and restores the input text', async () => {
  const user = userEvent.setup()
  renderPage()

  const input = await screen.findByPlaceholderText('Добавить позицию…')
  await user.type(input, 'Молоко')
  await user.click(screen.getByLabelText('Добавить'))

  expect(await screen.findByText('Молоко')).toBeInTheDocument()

  // Server rejects the POST (500).
  postDeferred.resolve({
    ok: false,
    status: 500,
    json: async () => ({ error: 'boom' }),
  })

  // Optimistic row is rolled back and the text is restored to the input.
  await waitFor(() => expect(screen.queryByText('Молоко')).not.toBeInTheDocument())
  expect(input).toHaveValue('Молоко')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/components/list-detail-add.test.tsx -t "restores the input"`
Expected: FAIL — without `onError`, the temp row stays in the cache (still shows "Молоко") and the input is not restored.

- [ ] **Step 3: Add `onError` to `addMutation`**

In `app/(app)/lists/[id]/page.tsx`, add an `onError` handler to `addMutation` (after `onSuccess`):

```tsx
    onError: (_err, name, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['items', listId], ctx.previous)
      }
      setInputValue((current) => (current.trim() === '' ? name : current))
    },
```

(`setInputValue` only restores when the field is empty, so it won't clobber text the user has started typing for the next item.)

- [ ] **Step 4: Run both tests to verify they pass**

Run: `npx jest tests/components/list-detail-add.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/lists/[id]/page.tsx tests/components/list-detail-add.test.tsx
git commit -m "feat(ui): roll back optimistic add and restore input on error

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- `crypto.randomUUID()` is available as a global in the Node version this project runs and in jsdom; no import needed.
- The optimistic row deliberately starts with `category: null` so `groupItemsByCategory` places it under "Без категории"; when the real row replaces it, framer-motion's `layout` prop animates the move to the correct category group. This visible move is expected behavior, not a bug.
- Do not add an `onSettled` refetch of `['items', listId]` — concurrent in-flight adds rely on the cache not being overwritten by a server fetch that omits not-yet-persisted rows.
