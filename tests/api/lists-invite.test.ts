import { testApiHandler } from 'next-test-api-route-handler'
import * as inviteHandler from '@/app/api/lists/[id]/invite/route'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listInvite: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

const mockGetSession = getSession as jest.Mock
const fakeList = { id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date() }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('POST /api/lists/:id/invite', () => {
  it('returns existing active invite without regenerating', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    const future = new Date(Date.now() + 60 * 60 * 1000)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', token: 'existing-token', expiresAt: future, createdAt: new Date(),
    })

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).toBe('existing-token')
        expect(prisma.listInvite.upsert).not.toHaveBeenCalled()
      },
    })
  })

  it('upserts new invite when none exists', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.listInvite.upsert as jest.Mock).mockImplementation(({ create }) =>
      Promise.resolve({ listId: 'list-1', ...create, createdAt: new Date() }),
    )

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).toEqual(expect.any(String))
        expect(body.data.token.length).toBeGreaterThan(20)
        expect(prisma.listInvite.upsert).toHaveBeenCalledTimes(1)
      },
    })
  })

  it('regenerates when existing invite is expired', async () => {
    mockGetSession.mockResolvedValue({ userId: 'owner-1', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)
    const past = new Date(Date.now() - 60 * 60 * 1000)
    ;(prisma.listInvite.findUnique as jest.Mock).mockResolvedValue({
      listId: 'list-1', token: 'expired-token', expiresAt: past, createdAt: new Date(),
    })
    ;(prisma.listInvite.upsert as jest.Mock).mockImplementation(({ create }) =>
      Promise.resolve({ listId: 'list-1', ...create, createdAt: new Date() }),
    )

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.data.token).not.toBe('expired-token')
        expect(prisma.listInvite.upsert).toHaveBeenCalled()
      },
    })
  })

  it('returns 403 for non-owner', async () => {
    mockGetSession.mockResolvedValue({ userId: 'other', email: 'o@x.com' })
    ;(prisma.list.findUnique as jest.Mock).mockResolvedValue(fakeList)

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(403)
      },
    })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: inviteHandler,
      params: { id: 'list-1' },
      async test({ fetch }) {
        const res = await fetch({ method: 'POST' })
        expect(res.status).toBe(401)
      },
    })
  })
})
