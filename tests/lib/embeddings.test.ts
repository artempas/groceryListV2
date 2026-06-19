import { embed } from '@/lib/embeddings'

const realFetch = global.fetch

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENROUTER_EMBEDDING_MODEL
})

afterEach(() => {
  global.fetch = realFetch
})

describe('embed', () => {
  it('posts to the OpenRouter embeddings endpoint and returns the vector', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

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
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    await embed('клубника', 'Find the grocery department')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.input).toBe('Instruct: Find the grocery department\nQuery:клубника')
  })

  it('uses OPENROUTER_EMBEDDING_MODEL when set', async () => {
    process.env.OPENROUTER_EMBEDDING_MODEL = 'cohere/embed-v3'
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1] }] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    await embed('x')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('cohere/embed-v3')
  })

  it('throws when API key is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(embed('x')).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch
    await expect(embed('x')).rejects.toThrow()
  })
})
