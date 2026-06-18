import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { acceptInvite } from '@/lib/invite-accept'
import { InviteError } from './InviteResult'

export default async function InvitePage({ params }: { params: { token: string } }) {
  const session = await getSession()
  if (!session) {
    redirect(`/login?next=/invite/${encodeURIComponent(params.token)}`)
  }

  const result = await acceptInvite(params.token, session.userId)
  if (result.ok) {
    redirect(`/lists/${result.listId}`)
  }

  if (result.reason === 'expired') {
    return (
      <InviteError
        title="Срок действия ссылки истёк"
        message="Попросите владельца сгенерировать новую."
      />
    )
  }

  return (
    <InviteError
      title="Ссылка недействительна"
      message="Ссылка недействительна или список удалён."
    />
  )
}
