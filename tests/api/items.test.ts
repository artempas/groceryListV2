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
    listMembership: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

jest.mock('@/lib/categorize', () => ({ categorize: jest.fn() }))
jest.mock('@/lib/list-events', () => ({ emitListEvent: jest.fn() }))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { categorize } from '@/lib/categorize'
import { emitListEvent } from '@/lib/list-events'
const mockEmit = emitListEvent as jest.Mock
const mockGetSession = getSession as jest.Mock
const mockList = prisma.list as jest.Mocked<typeof prisma.list>
const mockItem = prisma.listItem as jest.Mocked<typeof prisma.listItem>
const mockCategorize = categorize as jest.Mock

const session = { userId: 'user-1', email: 'a@b.com' }
const list = { id: 'list-1', name: 'G', ownerId: 'user-1', createdAt: new Date() }
const item = {
  id: 'item-1', name: 'Milk', listId: 'list-1',
  createdById: 'user-1', createdAt: new Date(),
  checkedAt: null, checkedById: null,
  category: null,
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
    mockCategorize.mockResolvedValue(null)
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

describe('list event emission', () => {
  it('emits item.added with the originClientId header after POST', async () => {
    mockCategorize.mockResolvedValue(null)
    mockItem.create.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemsHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-client-id': 'tab-1' },
          body: JSON.stringify({ name: 'Milk' }),
        })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.added',
      originClientId: 'tab-1',
      payload: expect.objectContaining({ id: 'item-1' }),
    }))
  })

  it('emits item.updated after PATCH', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.update.mockResolvedValue({ ...item, checkedAt: new Date(), checkedById: 'user-1' })

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-client-id': 'tab-1' },
          body: JSON.stringify({ checked: true }),
        })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.updated',
      originClientId: 'tab-1',
      payload: expect.objectContaining({ id: 'item-1', checkedAt: expect.any(Date) }),
    }))
  })

  it('emits item.deleted after DELETE', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.delete.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({ method: 'DELETE', headers: { 'x-client-id': 'tab-1' } })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      type: 'item.deleted', originClientId: 'tab-1', payload: { id: 'item-1' },
    }))
  })

  it('emits with originClientId null when header is absent', async () => {
    mockItem.findUnique.mockResolvedValue(item)
    mockItem.delete.mockResolvedValue(item)

    await testApiHandler({
      appHandler: itemHandler,
      params: { id: 'list-1', itemId: 'item-1' },
      async test({ fetch }) {
        await fetch({ method: 'DELETE' })
      },
    })

    expect(mockEmit).toHaveBeenCalledWith('list-1', expect.objectContaining({
      originClientId: null,
    }))
  })
})
