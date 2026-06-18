import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'

async function findItem(listId: string, itemId: string) {
  const item = await prisma.listItem.findUnique({ where: { id: itemId } })
  if (!item || item.listId !== listId) return null
  return item
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const item = await findItem(params.id, params.itemId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { checked } = await request.json()

  const updated = await prisma.listItem.update({
    where: { id: params.itemId },
    data: checked
      ? { checkedAt: new Date(), checkedById: session.userId }
      : { checkedAt: null, checkedById: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(
  _: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const item = await findItem(params.id, params.itemId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listItem.delete({ where: { id: params.itemId } })
  return NextResponse.json({ data: null })
}
