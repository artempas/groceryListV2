import { prisma } from '@/lib/prisma'

export type AcceptResult =
  | { ok: true; listId: string; listName: string }
  | { ok: false; reason: 'not_found' | 'expired' }

export async function acceptInvite(token: string, userId: string): Promise<AcceptResult> {
  const invite = await prisma.listInvite.findUnique({
    where: { token },
    include: { list: true },
  })
  if (!invite) return { ok: false, reason: 'not_found' }
  if (invite.expiresAt <= new Date()) return { ok: false, reason: 'expired' }

  const isOwner = invite.list.ownerId === userId
  if (!isOwner) {
    await prisma.listMembership.upsert({
      where: { listId_userId: { listId: invite.listId, userId } },
      create: { listId: invite.listId, userId },
      update: {},
    })
  }

  return { ok: true, listId: invite.listId, listName: invite.list.name }
}
