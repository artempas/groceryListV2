import categoryVectorsData from '@/lib/category-vectors.json'
import { embed } from '@/lib/embeddings'

export interface CategoryVector {
  name: string
  vector: number[]
}

const DEFAULT_THRESHOLD = 0.3

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/** Loads precomputed category vectors; returns [] if the file is missing/invalid. */
export function getCategoryVectors(): CategoryVector[] {
  return categoryVectorsData as unknown as CategoryVector[]
}

export function pickCategory(
  itemVector: number[],
  categories: CategoryVector[],
  threshold: number,
): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const cat of categories) {
    if (cat.vector.length !== itemVector.length) continue
    const score = cosineSimilarity(itemVector, cat.vector)
    if (score > bestScore) {
      bestScore = score
      best = cat.name
    }
  }
  return bestScore >= threshold ? best : null
}

/**
 * Returns the category name for `name`, or null on any failure / low confidence.
 * Never throws — categorization must never break item creation.
 */
export async function categorize(
  name: string,
  loadVectors: () => CategoryVector[] = getCategoryVectors,
): Promise<string | null> {
  try {
    const vectors = loadVectors()
    if (vectors.length === 0) return null
    const parsed = process.env.CATEGORY_MATCH_THRESHOLD
      ? parseFloat(process.env.CATEGORY_MATCH_THRESHOLD)
      : DEFAULT_THRESHOLD
    const threshold = Number.isFinite(parsed) ? parsed : DEFAULT_THRESHOLD
    const vector = await embed(name)
    return pickCategory(vector, vectors, threshold)
  } catch {
    return null
  }
}
