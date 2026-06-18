import { readFileSync } from 'fs'
import { join } from 'path'
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

let cached: CategoryVector[] | null = null

/** Loads precomputed category vectors; returns [] if the file is missing/invalid. */
export function getCategoryVectors(): CategoryVector[] {
  if (cached) return cached
  try {
    const raw = readFileSync(join(process.cwd(), 'lib', 'category-vectors.json'), 'utf8')
    cached = JSON.parse(raw) as CategoryVector[]
  } catch {
    cached = []
  }
  return cached
}

export function pickCategory(
  itemVector: number[],
  categories: CategoryVector[],
  threshold: number,
): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const cat of categories) {
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
    const threshold = process.env.CATEGORY_MATCH_THRESHOLD
      ? parseFloat(process.env.CATEGORY_MATCH_THRESHOLD)
      : DEFAULT_THRESHOLD
    const vector = await embed(name)
    return pickCategory(vector, loadVectors(), threshold)
  } catch {
    return null
  }
}
