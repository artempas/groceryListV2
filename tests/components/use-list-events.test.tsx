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

test('clientId is stable and no second EventSource opens on re-render', () => {
  const qc = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result, rerender } = renderHook(() => useListEvents('list-1'), { wrapper })
  const clientIdBefore = result.current
  rerender()
  const clientIdAfter = result.current
  expect(clientIdAfter).toBe(clientIdBefore)
  expect(MockEventSource.instances.length).toBe(1)
})

function renderForReconnect() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return renderHook(() => useListEvents('list-1'), { wrapper })
}

test('reconnects after the connection closes permanently', () => {
  jest.useFakeTimers()
  try {
    renderForReconnect()
    const es1 = MockEventSource.instances[0]
    es1.readyState = MockEventSource.CLOSED // browser gave up (fatal error)
    act(() => es1.onerror!())
    act(() => {
      jest.advanceTimersByTime(30000)
    })
    expect(MockEventSource.instances.length).toBe(2)
    expect(MockEventSource.instances[1].url).toBe(es1.url) // same list + clientId
  } finally {
    jest.useRealTimers()
  }
})

test('does not open a new EventSource while the browser is auto-retrying', () => {
  jest.useFakeTimers()
  try {
    renderForReconnect()
    const es1 = MockEventSource.instances[0]
    es1.readyState = MockEventSource.CONNECTING // native reconnect in progress
    act(() => es1.onerror!())
    act(() => {
      jest.advanceTimersByTime(30000)
    })
    expect(MockEventSource.instances.length).toBe(1)
  } finally {
    jest.useRealTimers()
  }
})

test('does not reconnect after unmount', () => {
  jest.useFakeTimers()
  try {
    const { unmount } = renderForReconnect()
    const es1 = MockEventSource.instances[0]
    es1.readyState = MockEventSource.CLOSED
    act(() => es1.onerror!())
    unmount()
    act(() => {
      jest.advanceTimersByTime(30000)
    })
    expect(MockEventSource.instances.length).toBe(1)
  } finally {
    jest.useRealTimers()
  }
})
