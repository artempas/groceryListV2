import { prisma } from '@/lib/prisma'
import type { List } from '@prisma/client'

export type AccessErr = { error: 'Not found' | 'Forbidden'; status: 404 | 403 }
export type AccessOk = { list: List; isOwner: boolean }
export type OwnerOk = { list: List }

export async function requireListAccess(
  userId: string,
  listId: string,
): Promise<AccessOk | AccessErr> {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId === userId) return { list, isOwner: true }

  const membership = await prisma.listMembership.findUnique({
    where: { listId_userId: { listId, userId } },
  })
  if (membership) return { list, isOwner: false }

  return { error: 'Forbidden', status: 403 }
}

export async function requireListOwner(
  userId: string,
  listId: string,
): Promise<OwnerOk | AccessErr> {
  const list = await prisma.list.findUnique({ where: { id: listId } })
  if (!list) return { error: 'Not found', status: 404 }
  if (list.ownerId !== userId) return { error: 'Forbidden', status: 403 }
  return { list }
}
