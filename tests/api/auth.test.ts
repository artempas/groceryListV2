import { testApiHandler } from 'next-test-api-route-handler'
import * as registerHandler from '@/app/api/auth/register/route'
import * as loginHandler from '@/app/api/auth/login/route'
import * as meHandler from '@/app/api/auth/me/route'
import bcrypt from 'bcryptjs'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

jest.mock('@/lib/auth', () => ({
  ...jest.requireActual('@/lib/auth'),
  getSession: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
const mockPrisma = prisma as jest.Mocked<typeof prisma>
const mockGetSession = getSession as jest.Mock

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  jest.clearAllMocks()
})

describe('POST /api/auth/register', () => {
  it('creates a user and returns 201 with Set-Cookie', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(mockPrisma.user.create as jest.Mock).mockResolvedValue({
      id: 'u1', name: 'Test', email: 'a@b.com', createdAt: new Date(),
    })

    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test', email: 'a@b.com', password: 'password123' }),
        })
        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.data.email).toBe('a@b.com')
        expect(res.headers.get('set-cookie')).toContain('auth-token')
      },
    })
  })

  it('returns 409 when email already exists', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' })

    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'X', email: 'a@b.com', password: 'pass' }),
        })
        expect(res.status).toBe(409)
      },
    })
  })

  it('returns 400 when fields are missing', async () => {
    await testApiHandler({
      appHandler: registerHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com' }),
        })
        expect(res.status).toBe(400)
      },
    })
  })
})

describe('POST /api/auth/login', () => {
  it('returns 200 with Set-Cookie on valid credentials', async () => {
    const hash = await bcrypt.hash('secret', 10)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1', email: 'a@b.com', name: 'Test', createdAt: new Date(), passwordHash: hash,
    })

    await testApiHandler({
      appHandler: loginHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'secret' }),
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('set-cookie')).toContain('auth-token')
      },
    })
  })

  it('returns 401 on wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1', email: 'a@b.com', name: 'Test', createdAt: new Date(), passwordHash: hash,
    })

    await testApiHandler({
      appHandler: loginHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
        })
        expect(res.status).toBe(401)
      },
    })
  })
})

describe('GET /api/auth/me', () => {
  it('returns 401 without cookie', async () => {
    mockGetSession.mockResolvedValue(null)

    await testApiHandler({
      appHandler: meHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
      },
    })
  })
})
