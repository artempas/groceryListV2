import { CATEGORIES, CATEGORY_NAMES } from '@/lib/categories'

describe('CATEGORIES', () => {
  it('has at least 10 categories', () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(10)
  })

  it('every category has a non-empty name and reference phrase', () => {
    for (const c of CATEGORIES) {
      expect(c.name.trim().length).toBeGreaterThan(0)
      expect(c.reference.trim().length).toBeGreaterThan(0)
    }
  })

  it('category names are unique', () => {
    expect(new Set(CATEGORY_NAMES).size).toBe(CATEGORY_NAMES.length)
  })

  it('CATEGORY_NAMES matches CATEGORIES order', () => {
    expect(CATEGORY_NAMES).toEqual(CATEGORIES.map((c) => c.name))
  })
})
