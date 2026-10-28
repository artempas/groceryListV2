import { testApiHandler } from 'next-test-api-route-handler'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import * as oidcLoginHandler from '@/app/api/auth/oidc/login/route'
import * as oidcCallbackHandler from '@/app/api/auth/oidc/callback/route'
import { clearOidcCache, createAuthorizationRequest, getOidcConfig, OIDC_FLOW_COOKIE } from '@/lib/oidc'
import { verifyToken } from '@/lib/auth'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
const mockUser = prisma.user as unknown as Record<'findUnique' | 'findFirst' | 'create' | 'update', jest.Mock>

const ISSUER = 'https://auth.example.com/application/o/grocery/'
const APP_URL = 'https://grocery.example.com'
const REDIRECT_URI = `${APP_URL}/api/auth/oidc/callback`
const CLIENT_SECRET = 'client-secret-that-is-long-enough-for-hs256'

const discovery = {
  issuer: ISSUER,
  authorization_endpoint: 'https://auth.example.com/application/o/authorize/',
  token_endpoint: 'https://auth.example.com/application/o/token/',
  userinfo_endpoint: 'https://auth.example.com/application/o/userinfo/',
  jwks_uri: 'https://auth.example.com/application/o/grocery/jwks/',
}

// Requests to the fake IdP are answered here; everything else (the test
// server used by testApiHandler) goes through the real fetch.
const realFetch = globalThis.fetch
let idpHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function hsIdToken(claims: Record<string, unknown>) {
  return new SignJWT({ sub: 'authentik-sub-1', email: 'a@b.com', email_verified: true, name: 'Alice', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('grocery-client')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(CLIENT_SECRET))
}

async function startFlow(next = '/lists/l1') {
  const config = getOidcConfig()!
  const { url, flowToken } = await createAuthorizationRequest(config, REDIRECT_URI, next)
  const params = new URL(url).searchParams
  return { flowToken, state: params.get('state')!, nonce: params.get('nonce')! }
}

async function callCallback(query: string, flowToken?: string) {
  let res!: Response
  await testApiHandler({
    appHandler: oidcCallbackHandler,
    url: `/api/auth/oidc/callback?${query}`,
    async test({ fetch }) {
      res = await fetch({
        method: 'GET',
        redirect: 'manual',
        headers: flowToken ? { cookie: `${OIDC_FLOW_COOKIE}=${flowToken}` } : {},
      })
    },
  })
  return res
}

function sessionCookie(res: Response) {
  return res.headers.getSetCookie().find((c) => c.startsWith('auth-token='))
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-chars!!'
  process.env.OIDC_ISSUER = ISSUER
  process.env.OIDC_CLIENT_ID = 'grocery-client'
  process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET
  process.env.OIDC_PROVIDER_NAME = 'Authentik'
  process.env.APP_URL = APP_URL
  delete process.env.OIDC_TRUST_EMAIL
  clearOidcCache()
  jest.clearAllMocks()

  idpHandler = (url) => {
    if (url === `${ISSUER.replace(/\/$/, '')}/.well-known/openid-configuration`) return json(discovery)
    return json({ error: 'unexpected' }, 500)
  }
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://auth.example.com/')) return idpHandler(url, init)
    return realFetch(input, init)
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  for (const key of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_PROVIDER_NAME', 'APP_URL']) {
    delete process.env[key]
  }
})

function withTokenEndpoint(idToken: string, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const base = idpHandler
  const calls: { url: string; init?: RequestInit }[] = []
  idpHandler = (url, init) => {
    calls.push({ url, init })
    if (url === discovery.token_endpoint) return json({ id_token: idToken, access_token: 'at' })
    return extra?.(url, init) ?? base(url, init)
  }
  return calls
}

describe('GET /api/auth/oidc/login', () => {
  it('returns 404 when SSO is not configured', async () => {
    delete process.env.OIDC_ISSUER
    await testApiHandler({
      appHandler: oidcLoginHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', redirect: 'manual' })
        expect(res.status).toBe(404)
      },
    })
  })

  it('redirects to the IdP with PKCE and sets the flow cookie', async () => {
    await testApiHandler({
      appHandler: oidcLoginHandler,
      url: '/api/auth/oidc/login?next=%2Flists%2Fl1',
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', redirect: 'manual' })
        expect(res.status).toBe(307)
        const location = new URL(res.headers.get('location')!)
        expect(location.origin + location.pathname).toBe(discovery.authorization_endpoint)
        expect(location.searchParams.get('client_id')).toBe('grocery-client')
        expect(location.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
        expect(location.searchParams.get('scope')).toBe('openid email profile')
        expect(location.searchParams.get('code_challenge_method')).toBe('S256')
        expect(location.searchParams.get('state')).toBeTruthy()
        expect(location.searchParams.get('nonce')).toBeTruthy()
        expect(res.headers.get('set-cookie')).toContain(`${OIDC_FLOW_COOKIE}=`)
      },
    })
  })

  it('redirects back to /login with an error when discovery fails', async () => {
    idpHandler = () => json({}, 503)
    await testApiHandler({
      appHandler: oidcLoginHandler,
      async test({ fetch }) {
        const res = await fetch({ method: 'GET', redirect: 'manual' })
        expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso`)
      },
    })
  })
})

describe('GET /api/auth/oidc/callback', () => {
  it('logs in an already linked user and redirects to next', async () => {
    const { flowToken, state, nonce } = await startFlow()
    const calls = withTokenEndpoint(await hsIdToken({ nonce }))
    mockUser.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(res.headers.get('location')).toBe(`${APP_URL}/lists/l1`)
    const cookie = sessionCookie(res)!
    const session = await verifyToken(cookie.split(';')[0].split('=')[1])
    expect(session.userId).toBe('u1')

    const tokenCall = calls.find((c) => c.url === discovery.token_endpoint)!
    const body = new URLSearchParams(tokenCall.init!.body as URLSearchParams)
    expect(body.get('code')).toBe('abc')
    expect(body.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(body.get('code_verifier')).toBeTruthy()
    expect(mockUser.findUnique).toHaveBeenCalledWith({ where: { oidcSubject: 'authentik-sub-1' } })
  })

  it('verifies RS256 ID tokens against the provider JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    const { flowToken, state, nonce } = await startFlow('/')
    const idToken = await new SignJWT({ sub: 'authentik-sub-1', email: 'a@b.com', nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('grocery-client')
      .setExpirationTime('5m')
      .sign(privateKey)
    withTokenEndpoint(idToken, (url) => (url === discovery.jwks_uri ? json({ keys: [jwk] }) : undefined))
    mockUser.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(res.headers.get('location')).toBe(`${APP_URL}/`)
    expect(sessionCookie(res)).toBeDefined()
  })

  it('creates a new password-less user on first login', async () => {
    const { flowToken, state, nonce } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce, name: undefined, preferred_username: 'alice' }))
    mockUser.findUnique.mockResolvedValue(null)
    mockUser.findFirst.mockResolvedValue(null)
    mockUser.create.mockResolvedValue({ id: 'u2', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(mockUser.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', name: 'alice', oidcSubject: 'authentik-sub-1' },
    })
    expect(sessionCookie(res)).toBeDefined()
  })

  it('links an existing account when the email is verified', async () => {
    const { flowToken, state, nonce } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce }))
    mockUser.findUnique.mockResolvedValue(null)
    mockUser.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.com', oidcSubject: null })
    mockUser.update.mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(mockUser.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { oidcSubject: 'authentik-sub-1' } })
    expect(sessionCookie(res)).toBeDefined()
  })

  it('refuses to link an existing account when the email is not verified', async () => {
    const { flowToken, state, nonce } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce, email_verified: false }))
    mockUser.findUnique.mockResolvedValue(null)
    mockUser.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.com', oidcSubject: null })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso_conflict`)
    expect(mockUser.update).not.toHaveBeenCalled()
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('links an unverified email when OIDC_TRUST_EMAIL is set', async () => {
    process.env.OIDC_TRUST_EMAIL = 'true'
    const { flowToken, state, nonce } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce, email_verified: false }))
    mockUser.findUnique.mockResolvedValue(null)
    mockUser.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.com', oidcSubject: null })
    mockUser.update.mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(sessionCookie(res)).toBeDefined()
  })

  it('fetches the email from userinfo when the ID token lacks it', async () => {
    const { flowToken, state, nonce } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce, email: undefined }), (url) =>
      url === discovery.userinfo_endpoint ? json({ sub: 'authentik-sub-1', email: 'a@b.com' }) : undefined,
    )
    mockUser.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await callCallback(`code=abc&state=${state}`, flowToken)

    expect(sessionCookie(res)).toBeDefined()
  })

  it('rejects a state mismatch', async () => {
    const { flowToken } = await startFlow()
    const res = await callCallback('code=abc&state=forged', flowToken)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso`)
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('rejects a callback without the flow cookie', async () => {
    const { state } = await startFlow()
    const res = await callCallback(`code=abc&state=${state}`)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso`)
  })

  it('rejects an ID token with the wrong nonce', async () => {
    const { flowToken, state } = await startFlow()
    withTokenEndpoint(await hsIdToken({ nonce: 'other' }))
    const res = await callCallback(`code=abc&state=${state}`, flowToken)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso`)
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('rejects an ID token issued for another client', async () => {
    const { flowToken, state, nonce } = await startFlow()
    const idToken = await new SignJWT({ sub: 'x', email: 'a@b.com', nonce })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('other-client')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(CLIENT_SECRET))
    withTokenEndpoint(idToken)
    const res = await callCallback(`code=abc&state=${state}`, flowToken)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=sso`)
  })

  it('does not accept a flow token as a session token', async () => {
    const { flowToken } = await startFlow()
    await expect(verifyToken(flowToken)).rejects.toThrow()
  })
})
