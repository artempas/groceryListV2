import { sortItems } from '@/lib/sort-items'

const mk = (id: string, createdAt: string, checkedAt: string | null) => ({ id, createdAt, checkedAt })

describe('sortItems', () => {
  it('puts unchecked items before checked items', () => {
    const checked = mk('a', '2026-06-19T10:00:00.000Z', '2026-06-19T11:00:00.000Z')
    const unchecked = mk('b', '2026-06-19T09:00:00.000Z', null)
    const out = sortItems([checked, unchecked])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('orders unchecked items by newest createdAt first', () => {
    const older = mk('a', '2026-06-19T09:00:00.000Z', null)
    const newer = mk('b', '2026-06-19T10:00:00.000Z', null)
    const out = sortItems([older, newer])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('orders checked items by most-recently-checked first', () => {
    const checkedEarly = mk('a', '2026-06-19T08:00:00.000Z', '2026-06-19T10:00:00.000Z')
    const checkedLate = mk('b', '2026-06-19T08:00:00.000Z', '2026-06-19T12:00:00.000Z')
    const out = sortItems([checkedEarly, checkedLate])
    expect(out.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input array', () => {
    const input = [mk('a', '2026-06-19T09:00:00.000Z', null), mk('b', '2026-06-19T10:00:00.000Z', null)]
    sortItems(input)
    expect(input.map((i) => i.id)).toEqual(['a', 'b'])
  })
})
