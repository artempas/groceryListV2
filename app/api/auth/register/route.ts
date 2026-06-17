import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken, authCookieOptions, COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, email, password } = body

  if (!name?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ error: 'name, email, and password are required' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { name: name.trim(), email: email.trim(), passwordHash },
    select: { id: true, email: true, name: true, createdAt: true },
  })

  const token = await signToken({ userId: user.id, email: user.email })
  const response = NextResponse.json({ data: user }, { status: 201 })
  response.cookies.set(COOKIE_NAME, token, authCookieOptions())
  return response
}
