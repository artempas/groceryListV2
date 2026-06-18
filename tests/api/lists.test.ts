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
    listMembership: { findUnique: jest.fn() },
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
    mockList.findMany.mockResolvedValue([{ ...fakeList, _count: { items: 2 } }] as any)

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
