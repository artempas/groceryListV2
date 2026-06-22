import { redirect, RedirectType } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// Root of the site. Redirects the user to the most relevant place:
//   - not authenticated  → /login
//   - exactly one list    → straight into that list
//   - otherwise (0 or 2+) → the lists overview at /lists
// The auto-into-single-list jump only happens here, at the site root.
export default async function Home() {
  const session = await getSession()
  if (!session) redirect('/login')

  const lists = await prisma.list.findMany({
    where: {
      OR: [
        { ownerId: session.userId },
        { memberships: { some: { userId: session.userId } } },
      ],
    },
    select: { id: true },
    take: 2,
  })

  if (lists.length === 1) redirect(`/lists/${lists[0].id}`, RedirectType.push)
  redirect('/lists')
}
