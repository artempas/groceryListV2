import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export const COOKIE_NAME = 'auth-token'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days in seconds (604800)

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is not set')
  return new TextEncoder().encode(secret)
}

export async function signToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string }> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as { userId: string; email: string }
}

export async function getSession(): Promise<{ userId: string; email: string } | null> {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    path: '/',
    maxAge: MAX_AGE,
    sameSite: 'lax' as const,
  }
}
