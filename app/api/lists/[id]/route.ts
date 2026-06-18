import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListOwner } from '@/lib/access'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const updated = await prisma.list.update({
    where: { id: params.id },
    data: { name: name.trim() },
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  await prisma.list.delete({ where: { id: params.id } })
  return NextResponse.json({ data: null })
}

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

  return NextResponse.json({
    data: {
      id: list.id,
      name: list.name,
      isOwner,
      owner: list.owner,
    },
  })
}
