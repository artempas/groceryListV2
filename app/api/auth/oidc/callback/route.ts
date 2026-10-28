import { NextRequest, NextResponse } from 'next/server'
import {
  getOidcConfig,
  getAppUrl,
  getRedirectUri,
  readFlowToken,
  completeAuthorization,
  flowCookieOptions,
  OIDC_FLOW_COOKIE,
} from '@/lib/oidc'
import { findOrCreateOidcUser } from '@/lib/oidc-user'
import { signToken, authCookieOptions, COOKIE_NAME } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const config = getOidcConfig()
  if (!config) return NextResponse.json({ error: 'SSO is not configured' }, { status: 404 })

  const appUrl = getAppUrl(request.nextUrl.origin)
  const params = request.nextUrl.searchParams

  function fail(error: string) {
    const response = NextResponse.redirect(`${appUrl}/login?error=${error}`)
    response.cookies.set(OIDC_FLOW_COOKIE, '', { ...flowCookieOptions(), maxAge: 0 })
    return response
  }

  const flowCookie = request.cookies.get(OIDC_FLOW_COOKIE)?.value
  if (!flowCookie) return fail('sso')

  let flow
  try {
    flow = await readFlowToken(flowCookie)
  } catch {
    return fail('sso')
  }

  const code = params.get('code')
  if (params.get('error') || !code || params.get('state') !== flow.state) {
    return fail('sso')
  }

  try {
    const identity = await completeAuthorization(config, getRedirectUri(appUrl), code, flow)
    const result = await findOrCreateOidcUser(identity)
    if (!result.ok) return fail('sso_conflict')

    const token = await signToken({ userId: result.user.id, email: result.user.email })
    const response = NextResponse.redirect(`${appUrl}${flow.next}`)
    response.cookies.set(COOKIE_NAME, token, authCookieOptions())
    response.cookies.set(OIDC_FLOW_COOKIE, '', { ...flowCookieOptions(), maxAge: 0 })
    return response
  } catch (err) {
    console.error('[oidc] login failed', err)
    return fail('sso')
  }
}
