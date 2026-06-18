import { testApiHandler } from 'next-test-api-route-handler'
import * as membersHandler from '@/app/api/lists/[id]/members/route'
import * as memberHandler from '@/app/api/lists/[id]/members/[userId]/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: { findUnique: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
const mockGetSession = getSession as jest.Mock

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('GET /api/lists/:id/members', () => {
  it('owner sees members list with owner block', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findMany as jest.Mock).mockResolvedValue([
      { userId: 'm1', joinedAt: new Date(), user: { id: 'm1', name: 'Bob' } },
    ])

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.owner).toEqual({ id: 'owner-1', name: 'Alice' })
        expect(body.data.members).toHaveLength(1)
        expect(body.data.members[0].name).toBe('Bob')
      },
    })
  })

  it('member can see members list', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.findMany as jest.Mock).mockResolvedValue([])

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('returns 403 for non-member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'stranger', email: 's@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
      owner: { id: 'owner-1', name: 'Alice' },
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: membersHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(403)
      },
    })
  })
})

describe('DELETE /api/lists/:id/members/:userId', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(401)
      },
    })
  })

  it('owner removes a member', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.delete as jest.Mock).mockResolvedValue({})

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('member removes themselves (self-leave)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'm1', joinedAt: new Date(),
    })
    ;(prisma.listMembership.delete as jest.Mock).mockResolvedValue({})

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(200)
      },
    })
  })

  it('non-owner cannot remove another user', async () => {
    mockGetSession.mockResolvedValue({ userId: 'm1', email: 'm@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'm2' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(403)
      },
    })
  })

  it('owner cannot remove themselves', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'owner-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(400)
      },
    })
  })

  it('returns 404 when membership does not exist', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue({
      id: 'list-1', name: 'L', ownerId: 'owner-1',
    })
    ;(prisma.listMembership.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: memberHandler,
      params: { id: 'list-1', userId: 'ghost' },
      async test({ fetch }) {
        const res = await fetch({ method: 'DELETE' })
        expect(res.status).toBe(404)
      },
    })
  })
})
