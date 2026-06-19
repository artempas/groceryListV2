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

it('does not throw and delivers nothing when an event is emitted after disconnect', async () => {
  await testApiHandler({
    appHandler: sseHandler,
    url: '/api/lists/list-1/events?clientId=reader-tab',
    params: { id: 'list-1' },
    async test({ fetch }) {
      const res = await fetch({ method: 'GET' })
      const reader = res.body!.getReader()
      // Cancel the reader to simulate client disconnect — triggers stream cancel() → cleanup().
      await reader.cancel()
      // Emitting after disconnect must not throw (send is unsubscribed by cleanup).
      expect(() =>
        emitListEvent('list-1', {
          type: 'item.added', listId: 'list-1', originClientId: 'other-tab',
          payload: {
            id: 'post-disconnect', name: 'Ghost', category: null, listId: 'list-1',
            createdAt: new Date('2026-06-19T00:00:00.000Z'), checkedAt: null,
            createdBy: { id: 'user-1', name: 'A' }, checkedBy: null,
          },
        })
      ).not.toThrow()
    },
  })
})
