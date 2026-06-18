import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireListOwner } from '@/lib/access'
import { INVITE_TTL_MS, generateInviteToken } from '@/lib/invite'

export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListOwner(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const existing = await prisma.listInvite.findUnique({ where: { listId: params.id } })
  if (existing && existing.expiresAt > new Date()) {
    return NextResponse.json({
      data: { token: existing.token, expiresAt: existing.expiresAt },
    })
  }

  const token = generateInviteToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await prisma.listInvite.upsert({
    where: { listId: params.id },
    create: { listId: params.id, token, expiresAt },
    update: { token, expiresAt },
  })

  return NextResponse.json({ data: { token: invite.token, expiresAt: invite.expiresAt } })
}
