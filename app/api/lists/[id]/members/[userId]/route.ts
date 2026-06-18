import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await prisma.list.findUnique({ where: { id: params.id } })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = list.ownerId === session.userId
  const isSelf = params.userId === session.userId

  if (isOwner && isSelf) {
    return NextResponse.json({ error: 'Owner cannot leave own list' }, { status: 400 })
  }
  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const membership = await prisma.listMembership.findUnique({
    where: { listId_userId: { listId: params.id, userId: params.userId } },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listMembership.delete({
    where: { listId_userId: { listId: params.id, userId: params.userId } },
  })
  return NextResponse.json({ data: null })
}
