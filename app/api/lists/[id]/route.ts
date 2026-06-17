import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

async function requireOwnList(session: { userId: string }, id: string) {
  const list = await prisma.list.findUnique({ where: { id } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== session.userId) return { error: 'Forbidden', status: 403 }
  return { list }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireOwnList(session, params.id)
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

  const check = await requireOwnList(session, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  await prisma.list.delete({ where: { id: params.id } })
  return NextResponse.json({ data: null })
}
