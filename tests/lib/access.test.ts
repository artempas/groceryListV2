import { requireListAccess, requireListOwner } from '@/lib/access'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    list: { findUnique: jest.fn() },
    listMembership: { findUnique: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
const mockList = prisma.list as jest.Mocked<typeof prisma.list>
const mockMembership = prisma.listMembership as jest.Mocked<typeof prisma.listMembership>

const fakeList = { id: 'list-1', name: 'L', ownerId: 'owner-1', createdAt: new Date() }

beforeEach(() => jest.clearAllMocks())

describe('requireListAccess', () => {
  it('returns 404 when list does not exist', async () => {
    mockList.findUnique.mockResolvedValue(null)
    const result = await requireListAccess('user-1', 'missing')
    expect(result).toEqual({ error: 'Not found', status: 404 })
  })

  it('returns isOwner=true for owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListAccess('owner-1', 'list-1')
    expect(result).toEqual({ list: fakeList, isOwner: true })
  })

  it('returns isOwner=false for member', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    mockMembership.findUnique.mockResolvedValue({
      listId: 'list-1', userId: 'member-1', joinedAt: new Date(),
    } as any)
    const result = await requireListAccess('member-1', 'list-1')
    expect(result).toEqual({ list: fakeList, isOwner: false })
  })

  it('returns 403 for non-member non-owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    mockMembership.findUnique.mockResolvedValue(null)
    const result = await requireListAccess('stranger', 'list-1')
    expect(result).toEqual({ error: 'Forbidden', status: 403 })
  })
})

describe('requireListOwner', () => {
  it('returns 404 when list does not exist', async () => {
    mockList.findUnique.mockResolvedValue(null)
    const result = await requireListOwner('user-1', 'missing')
    expect(result).toEqual({ error: 'Not found', status: 404 })
  })

  it('returns list for owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListOwner('owner-1', 'list-1')
    expect(result).toEqual({ list: fakeList })
  })

  it('returns 403 for non-owner', async () => {
    mockList.findUnique.mockResolvedValue(fakeList as any)
    const result = await requireListOwner('other-user', 'list-1')
    expect(result).toEqual({ error: 'Forbidden', status: 403 })
  })
})
