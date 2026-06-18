export interface ItemGroup<T> {
  category: string | null
  items: T[]
}

/**
 * Groups items by their category in `order`. Empty categories are omitted.
 * Items whose category is null or not in `order` go into a trailing null group.
 */
export function groupItemsByCategory<T extends { category: string | null }>(
  items: T[],
  order: string[],
): ItemGroup<T>[] {
  const known = new Set(order)
  const buckets = new Map<string, T[]>()
  const leftover: T[] = []

  for (const item of items) {
    if (item.category && known.has(item.category)) {
      const bucket = buckets.get(item.category)
      if (bucket) bucket.push(item)
      else buckets.set(item.category, [item])
    } else {
      leftover.push(item)
    }
  }

  const groups: ItemGroup<T>[] = []
  for (const name of order) {
    const bucket = buckets.get(name)
    if (bucket && bucket.length > 0) groups.push({ category: name, items: bucket })
  }
  if (leftover.length > 0) groups.push({ category: null, items: leftover })
  return groups
}
