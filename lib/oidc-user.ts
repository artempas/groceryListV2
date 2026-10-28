import { prisma } from '@/lib/prisma'
import type { OidcIdentity } from '@/lib/oidc'

export type OidcUserResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; reason: 'email_conflict' }

/**
 * Resolves the local user for an SSO identity: by linked subject first, then by
 * linking an existing account with the same (verified) email, otherwise by
 * creating a new password-less account.
 */
export async function findOrCreateOidcUser(identity: OidcIdentity): Promise<OidcUserResult> {
  const linked = await prisma.user.findUnique({ where: { oidcSubject: identity.subject } })
  if (linked) return { ok: true, user: linked }

  const existing = await prisma.user.findFirst({
    where: { email: { equals: identity.email, mode: 'insensitive' } },
  })
  if (existing) {
    // Only take over an existing account when the IdP vouches for the email,
    // and never re-bind an account already linked to another SSO identity.
    if (existing.oidcSubject || !identity.emailVerified) return { ok: false, reason: 'email_conflict' }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { oidcSubject: identity.subject },
    })
    return { ok: true, user }
  }

  const user = await prisma.user.create({
    data: { email: identity.email, name: identity.name, oidcSubject: identity.subject },
  })
  return { ok: true, user }
}
