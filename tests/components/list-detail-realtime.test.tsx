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
