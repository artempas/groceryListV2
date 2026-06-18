const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const DEFAULT_MODEL = 'openai/text-embedding-3-small'

/**
 * Returns the embedding vector for `text` via OpenRouter.
 * Throws if the API key is missing or the request fails.
 */
export async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')

  const model = process.env.OPENROUTER_EMBEDDING_MODEL || DEFAULT_MODEL

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: text }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenRouter embeddings failed: ${res.status} ${detail}`)
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] }
  const vector = json.data?.[0]?.embedding
  if (!vector) throw new Error('OpenRouter embeddings response had no vector')
  return vector
}
