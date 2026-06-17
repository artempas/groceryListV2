import { signToken, verifyToken } from '@/lib/auth'

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
})

describe('signToken / verifyToken', () => {
  it('round-trips a payload', async () => {
    const payload = { userId: 'user-1', email: 'a@b.com' }
    const token = await signToken(payload)
    const result = await verifyToken(token)
    expect(result.userId).toBe('user-1')
    expect(result.email).toBe('a@b.com')
  })

  it('throws on a tampered token', async () => {
    await expect(verifyToken('not.a.real.token')).rejects.toThrow()
  })

  it('token is a non-empty string', async () => {
    const token = await signToken({ userId: 'u', email: 'e@e.com' })
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })
})
