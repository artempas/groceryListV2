import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { COOKIE_NAME } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    await verifyToken(token)
    return NextResponse.next()
  } catch {
    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return response
  }
}

export const config = {
  matcher: ['/', '/lists/:path*'],
}
