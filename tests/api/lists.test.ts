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
const mockList = prisma.list as jest.Mocked<typeof prisma.list>

const fakeSession = { userId: 'user-1', email: 'a@b.com' }
const fakeList = { id: 'list-1', name: 'Groceries', ownerId: 'user-1', createdAt: new Date() }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

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
