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
