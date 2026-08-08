const mockFetch = jest.fn()

jest.mock('undici', () => {
  const actual = jest.requireActual('undici')
  return {
    ...actual,
    fetch: (...args: unknown[]) => mockFetch(...args),
  }
})

import { embed } from '@/lib/embeddings'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENROUTER_EMBEDDING_MODEL
  delete process.env.OPENROUTER_PROXY_URL
  delete process.env.HTTPS_PROXY
  delete process.env.https_proxy
  mockFetch.mockReset()
})

describe('embed', () => {
  it('posts to the OpenRouter embeddings endpoint and returns the vector', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    })

    const vector = await embed('молоко')

    expect(vector).toEqual([0.1, 0.2, 0.3])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('openai/text-embedding-3-small')
    expect(body.input).toBe('молоко')
  })

  it('wraps the input in the Qwen3 query template when an instruction is given', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })

    await embed('клубника', 'Find the grocery department')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input).toBe('Instruct: Find the grocery department\nQuery:клубника')
  })

  it('uses OPENROUTER_EMBEDDING_MODEL when set', async () => {
    process.env.OPENROUTER_EMBEDDING_MODEL = 'cohere/embed-v3'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })

    await embed('x')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('cohere/embed-v3')
  })

  it('throws when API key is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(embed('x')).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })
    await expect(embed('x')).rejects.toThrow()
  })

  it('routes the request through OPENROUTER_PROXY_URL when set', async () => {
    process.env.OPENROUTER_PROXY_URL = 'http://proxy.internal:8080'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })

    await embed('x')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.dispatcher).toBeDefined()
  })

  it('falls back to HTTPS_PROXY when OPENROUTER_PROXY_URL is not set', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.internal:8080'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })

    await embed('x')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.dispatcher).toBeDefined()
  })

  it('does not set a dispatcher when no proxy is configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })

    await embed('x')

    const [, init] = mockFetch.mock.calls[0]
    expect(init.dispatcher).toBeUndefined()
  })
})
