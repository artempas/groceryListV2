import { NextRequest, NextResponse } from 'next/server'
import {
  getOidcConfig,
  getAppUrl,
  getRedirectUri,
  createAuthorizationRequest,
  flowCookieOptions,
  OIDC_FLOW_COOKIE,
} from '@/lib/oidc'
import { sanitizeNext } from '@/lib/sanitize-next'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const config = getOidcConfig()
  if (!config) return NextResponse.json({ error: 'SSO is not configured' }, { status: 404 })

  const appUrl = getAppUrl(request.nextUrl.origin)
  const next = sanitizeNext(request.nextUrl.searchParams.get('next'))

  try {
    const { url, flowToken } = await createAuthorizationRequest(config, getRedirectUri(appUrl), next)
    const response = NextResponse.redirect(url)
    response.cookies.set(OIDC_FLOW_COOKIE, flowToken, flowCookieOptions())
    return response
  } catch (err) {
    console.error('[oidc] failed to start login', err)
    return NextResponse.redirect(`${appUrl}/login?error=sso`)
  }
}
