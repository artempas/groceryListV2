import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { acceptInvite } from '@/lib/invite-accept'

export async function POST(_: NextRequest, { params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await acceptInvite(params.token, session.userId)
  if (!result.ok) {
    if (result.reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Expired' }, { status: 410 })
  }
  return NextResponse.json({
    data: { listId: result.listId, listName: result.listName },
  })
}
