import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function POST(_: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invite = await prisma.listInvite.findUnique({
    where: { token: params.token },
    include: { list: true },
  })
  if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (invite.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'Expired' }, { status: 410 })
  }

  const isOwner = invite.list.ownerId === session.userId
  if (!isOwner) {
    await prisma.listMembership.upsert({
      where: { listId_userId: { listId: invite.listId, userId: session.userId } },
      create: { listId: invite.listId, userId: session.userId },
      update: {},
    })
  }

  return NextResponse.json({
    data: { listId: invite.listId, listName: invite.list.name },
  })
}
