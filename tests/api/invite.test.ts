import { testApiHandler } from 'next-test-api-route-handler'
import * as acceptHandler from '@/app/api/invite/[token]/accept/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    listInvite: { findUnique: jest.fn() },
    listMembership: { upsert: jest.fn() },
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

const validInvite = {
  listId: 'list-1',
  token: 'good-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  list: { id: 'list-1', name: 'L', ownerId: 'owner-1' },
}

describe('POST /api/invite/:token/accept', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(401)
      },
    })
  })

  it('returns 404 when token does not exist', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-1', email: 'u@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(null)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'missing' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(404)
      },
    })
  })

  it('returns 410 when invite has expired', async () => {
    mockGetSession.mockResolvedValue({ userId: 'user-1', email: 'u@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      ...validInvite,
      expiresAt: new Date(Date.now() - 1000),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(410)
      },
    })
  })

  it('owner accepting their own invite gets 200 without creating membership', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toEqual({ listId: 'list-1', listName: 'L' })
        expect(prisma.listMembership.upsert).not.toHaveBeenCalled()
      },
    })
  })

  it('creates membership and returns 200 for non-owner', async () => {
    mockGetSession.mockResolvedValue({ userId: 'guest', email: 'g@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)
    ;(prisma.listMembership.upsert as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'guest', joinedAt: new Date(),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data).toEqual({ listId: 'list-1', listName: 'L' })
        expect(prisma.listMembership.upsert).toHaveBeenCalledWith({
          where: { listId_userId: { listId: 'list-1', userId: 'guest' } },
          create: { listId: 'list-1', userId: 'guest' },
          update: {},
        })
      },
    })
  })

  it('is idempotent — already-member returns 200', async () => {
    mockGetSession.mockResolvedValue({ userId: 'guest', email: 'g@x.com' })
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(validInvite)
    ;(prisma.listMembership.upsert as jest.Mock).mockResolvedValue({
      listId: 'list-1', userId: 'guest', joinedAt: new Date(),
    })

    await testApiHandler({
      appHandler: acceptHandler,
      params: { token: 'good-token' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
      },
    })
  })
})
