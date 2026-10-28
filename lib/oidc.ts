import { createHash, randomBytes } from 'crypto'
import { SignJWT, jwtVerify, createRemoteJWKSet, base64url, type JWTVerifyGetKey } from 'jose'

/**
 * OpenID Connect (authorization code + PKCE) login against an external
 * identity provider such as Authentik. Enabled when OIDC_ISSUER,
 * OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are all set.
 */

export const OIDC_FLOW_COOKIE = 'oidc-flow'
const FLOW_MAX_AGE = 60 * 10 // 10 minutes
const DEFAULT_SCOPES = 'openid email profile'

export type OidcConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  providerName: string
  scopes: string
  trustEmail: boolean
}

export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim()
  const clientId = process.env.OIDC_CLIENT_ID?.trim()
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim()
  if (!issuer || !clientId || !clientSecret) return null

  return {
    issuer,
    clientId,
    clientSecret,
    providerName: process.env.OIDC_PROVIDER_NAME?.trim() || 'SSO',
    scopes: process.env.OIDC_SCOPES?.trim() || DEFAULT_SCOPES,
    trustEmail: process.env.OIDC_TRUST_EMAIL === 'true',
  }
}

/** Public base URL of the app, used to build the redirect URI. */
export function getAppUrl(fallbackOrigin: string): string {
  return (process.env.APP_URL?.trim() || fallbackOrigin).replace(/\/+$/, '')
}

export function getRedirectUri(appUrl: string): string {
  return `${appUrl}/api/auth/oidc/callback`
}

type Discovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri?: string
  userinfo_endpoint?: string
}

const discoveryCache = new Map<string, Promise<Discovery>>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function clearOidcCache() {
  discoveryCache.clear()
  jwksCache.clear()
}

async function fetchDiscovery(issuer: string): Promise<Discovery> {
  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
  const doc = (await res.json()) as Discovery
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error('OIDC discovery document is incomplete')
  }
  return doc
}

export function getDiscovery(issuer: string): Promise<Discovery> {
  let pending = discoveryCache.get(issuer)
  if (!pending) {
    pending = fetchDiscovery(issuer)
    discoveryCache.set(issuer, pending)
    // Don't cache failures: the IdP may just be temporarily unreachable.
    pending.catch(() => discoveryCache.delete(issuer))
  }
  return pending
}

type FlowState = { state: string; nonce: string; codeVerifier: string; next: string }

// Derived from JWT_SECRET but distinct from the session key, so a flow token
// can never be replayed as an auth-token cookie.
function getFlowSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is not set')
  return createHash('sha256').update(`oidc-flow:${secret}`).digest()
}

function randomToken() {
  return base64url.encode(randomBytes(32))
}

export function flowCookieOptions() {
  return {
    httpOnly: true,
    path: '/api/auth/oidc',
    maxAge: FLOW_MAX_AGE,
    sameSite: 'lax' as const,
  }
}

/**
 * Builds the IdP authorization URL and a signed token holding the
 * state/nonce/PKCE verifier, to be stored in the OIDC_FLOW_COOKIE.
 */
export async function createAuthorizationRequest(
  config: OidcConfig,
  redirectUri: string,
  next: string,
): Promise<{ url: string; flowToken: string }> {
  const discovery = await getDiscovery(config.issuer)
  const flow: FlowState = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(),
    next,
  }
  const codeChallenge = base64url.encode(createHash('sha256').update(flow.codeVerifier).digest())

  const url = new URL(discovery.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', config.scopes)
  url.searchParams.set('state', flow.state)
  url.searchParams.set('nonce', flow.nonce)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  const flowToken = await new SignJWT(flow)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${FLOW_MAX_AGE}s`)
    .sign(getFlowSecret())

  return { url: url.toString(), flowToken }
}

export async function readFlowToken(token: string): Promise<FlowState> {
  const { payload } = await jwtVerify(token, getFlowSecret())
  return payload as unknown as FlowState
}

export type OidcIdentity = {
  subject: string
  email: string
  emailVerified: boolean
  name: string
}

function getKeyResolver(config: OidcConfig, discovery: Discovery): JWTVerifyGetKey {
  return async (header, token) => {
    // Authentik signs with the client secret (HS256) when no signing key is
    // selected for the provider.
    if (header.alg?.startsWith('HS')) return new TextEncoder().encode(config.clientSecret)

    if (!discovery.jwks_uri) throw new Error('OIDC provider has no jwks_uri')
    let jwks = jwksCache.get(discovery.jwks_uri)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
      jwksCache.set(discovery.jwks_uri, jwks)
    }
    return jwks(header, token)
  }
}

/**
 * Exchanges the authorization code for tokens, validates the ID token and
 * returns the user's identity. Throws on any failure.
 */
export async function completeAuthorization(
  config: OidcConfig,
  redirectUri: string,
  code: string,
  flow: FlowState,
): Promise<OidcIdentity> {
  const discovery = await getDiscovery(config.issuer)

  const basic = Buffer.from(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
  ).toString('base64')
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: flow.codeVerifier,
    }),
  })
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '')
    throw new Error(`OIDC token exchange failed: ${tokenRes.status} ${detail}`)
  }
  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string }
  if (!tokens.id_token) throw new Error('OIDC token response has no id_token')

  const { payload } = await jwtVerify(tokens.id_token, getKeyResolver(config, discovery), {
    issuer: discovery.issuer,
    audience: config.clientId,
  })
  if (payload.nonce !== flow.nonce) throw new Error('OIDC nonce mismatch')
  if (!payload.sub) throw new Error('OIDC ID token has no sub')

  let claims: Record<string, unknown> = payload
  // Some providers only expose profile claims via the userinfo endpoint.
  if (!claims.email && discovery.userinfo_endpoint && tokens.access_token) {
    const infoRes = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    })
    if (infoRes.ok) {
      const info = (await infoRes.json()) as Record<string, unknown>
      if (info.sub === payload.sub) claims = { ...info, ...payload }
    }
  }

  const email = typeof claims.email === 'string' ? claims.email.trim() : ''
  if (!email) throw new Error('OIDC provider did not return an email (is the "email" scope allowed?)')

  const name =
    [claims.name, claims.preferred_username, claims.nickname].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    )?.trim() ?? email.split('@')[0]

  return {
    subject: payload.sub,
    email,
    emailVerified: claims.email_verified === true || config.trustEmail,
    name,
  }
}
