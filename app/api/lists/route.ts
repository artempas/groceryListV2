import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lists = await prisma.list.findMany({
    where: { ownerId: session.userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  })

  return NextResponse.json({ data: lists })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const list = await prisma.list.create({
    data: { name: name.trim(), ownerId: session.userId },
  })

  return NextResponse.json({ data: list }, { status: 201 })
}
