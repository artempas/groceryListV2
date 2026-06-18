import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lists = await prisma.list.findMany({
    where: {
      OR: [
        { ownerId: session.userId },
        { memberships: { some: { userId: session.userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  })

  const data = lists.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    owner: l.owner,
    isOwner: l.ownerId === session.userId,
    _count: l._count,
  }))

  return NextResponse.json({ data })
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
