import { groupItemsByCategory } from '@/lib/group-items'

const order = ['A', 'B']

it('groups items by category in the given order', () => {
  const items = [
    { id: 1, category: 'B' },
    { id: 2, category: 'A' },
    { id: 3, category: 'A' },
  ]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['A', 'B'])
  expect(groups[0].items.map((i) => i.id)).toEqual([2, 3])
  expect(groups[1].items.map((i) => i.id)).toEqual([1])
})

it('omits categories with no items', () => {
  const items = [{ id: 1, category: 'B' }]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['B'])
})

it('puts null-category items in a trailing group', () => {
  const items = [
    { id: 1, category: null },
    { id: 2, category: 'A' },
  ]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual(['A', null])
})

it('preserves input order within a group', () => {
  const items = [
    { id: 1, category: 'A' },
    { id: 2, category: 'A' },
  ]
  expect(groupItemsByCategory(items, order)[0].items.map((i) => i.id)).toEqual([1, 2])
})

it('groups unknown categories (not in order) under null', () => {
  const items = [{ id: 1, category: 'Zzz' }]
  const groups = groupItemsByCategory(items, order)
  expect(groups.map((g) => g.category)).toEqual([null])
  expect(groups[0].items.map((i) => i.id)).toEqual([1])
})
