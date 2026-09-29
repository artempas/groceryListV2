import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'
import { emitListEvent } from '@/lib/list-events'
import { CATEGORY_NAMES } from '@/lib/categories'

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

  const body = await request.json().catch(() => ({}))
  const { checked, category } = body as { checked?: unknown; category?: unknown }

  const data: Record<string, unknown> = {}
  if (typeof checked === 'boolean') {
    Object.assign(
      data,
      checked
        ? { checkedAt: new Date(), checkedById: session.userId }
        : { checkedAt: null, checkedById: null },
    )
  }
  if (category !== undefined) {
    if (category !== null && (typeof category !== 'string' || !CATEGORY_NAMES.includes(category))) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    data.category = category
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.listItem.update({
    where: { id: params.itemId },
    data,
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  emitListEvent(params.id, {
    type: 'item.updated',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: updated,
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const item = await findItem(params.id, params.itemId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.listItem.delete({ where: { id: params.itemId } })

  emitListEvent(params.id, {
    type: 'item.deleted',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: { id: params.itemId },
  })

  return NextResponse.json({ data: null })
}
