import { Suspense } from 'react'
import { getOidcConfig } from '@/lib/oidc'
import LoginForm from './LoginForm'

// SSO settings come from runtime env, so the page must not be prerendered at build time.
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const ssoProvider = getOidcConfig()?.providerName ?? null
  return (
    <Suspense>
      <LoginForm ssoProvider={ssoProvider} />
    </Suspense>
  )
}
