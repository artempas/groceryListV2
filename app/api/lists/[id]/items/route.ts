import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'
import { categorize } from '@/lib/categorize'
import { emitListEvent } from '@/lib/list-events'

const CHECKED_HISTORY_DAYS = 7

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const all = request.nextUrl.searchParams.get('all') === 'true'
  const cutoff = new Date(Date.now() - CHECKED_HISTORY_DAYS * 24 * 60 * 60 * 1000)

  const where = all
    ? { listId: params.id }
    : { listId: params.id, OR: [{ checkedAt: null }, { checkedAt: { gte: cutoff } }] }

  const [items, hiddenOlderCount] = await Promise.all([
    prisma.listItem.findMany({
      where,
      orderBy: [{ checkedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, name: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    }),
    all
      ? Promise.resolve(0)
      : prisma.listItem.count({ where: { listId: params.id, checkedAt: { lt: cutoff } } }),
  ])

  return NextResponse.json({ data: items, hiddenOlderCount })
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const { name } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const trimmed = name.trim()
  const category = await categorize(trimmed).catch(() => null)

  const item = await prisma.listItem.create({
    data: { name: trimmed, category, listId: params.id, createdById: session.userId },
    include: {
      createdBy: { select: { id: true, name: true } },
      checkedBy: { select: { id: true, name: true } },
    },
  })

  emitListEvent(params.id, {
    type: 'item.added',
    listId: params.id,
    originClientId: request.headers.get('x-client-id'),
    payload: item,
  })

  return NextResponse.json({ data: item }, { status: 201 })
}
