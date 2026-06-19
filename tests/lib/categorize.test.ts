jest.mock('@/lib/embeddings', () => ({ embed: jest.fn() }))

import { cosineSimilarity, pickCategory, categorize } from '@/lib/categorize'
import { embed } from '@/lib/embeddings'

const mockEmbed = embed as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CATEGORY_MATCH_THRESHOLD
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
  })
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
})

describe('pickCategory', () => {
  const cats = [
    { name: 'A', vector: [1, 0] },
    { name: 'B', vector: [0, 1] },
  ]
  it('returns the nearest category above threshold', () => {
    expect(pickCategory([0.9, 0.1], cats, 0.3)).toBe('A')
  })
  it('returns null when best similarity is below threshold', () => {
    expect(pickCategory([1, 1], cats, 0.95)).toBeNull()
  })
  it('returns null when there are no categories', () => {
    expect(pickCategory([1, 0], [], 0.3)).toBeNull()
  })
})

describe('categorize', () => {
  const vectors = [
    { name: 'A', vector: [1, 0] },
    { name: 'B', vector: [0, 1] },
  ]

  it('returns the matched category name', async () => {
    mockEmbed.mockResolvedValue([1, 0])
    await expect(categorize('thing', () => vectors)).resolves.toBe('A')
  })

  it('embeds the item name as an instructed query', async () => {
    mockEmbed.mockResolvedValue([1, 0])
    await categorize('thing', () => vectors)
    expect(mockEmbed).toHaveBeenCalledWith('thing', expect.any(String))
    expect(mockEmbed.mock.calls[0][1]).toBeTruthy()
  })

  it('returns null when embed throws (API error)', async () => {
    mockEmbed.mockRejectedValue(new Error('network'))
    await expect(categorize('thing', () => vectors)).resolves.toBeNull()
  })
})
