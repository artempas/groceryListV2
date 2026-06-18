import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await prisma.list.findUnique({
    where: { id: params.id },
    include: { owner: { select: { id: true, name: true } } },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = list.ownerId === session.userId
  if (!isOwner) {
    const membership = await prisma.listMembership.findUnique({
      where: { listId_userId: { listId: params.id, userId: session.userId } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const memberships = await prisma.listMembership.findMany({
    where: { listId: params.id },
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  })

  const members = memberships.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    joinedAt: m.joinedAt,
  }))

  return NextResponse.json({ data: { owner: list.owner, members } })
}
