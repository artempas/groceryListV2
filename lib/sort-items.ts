export interface SortableItem {
  checkedAt: string | Date | null
  createdAt: string | Date
}

function toMillis(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

// Matches the server orderBy: [{ checkedAt: desc, nulls: first }, { createdAt: desc }].
export function compareItems(a: SortableItem, b: SortableItem): number {
  const aUnchecked = a.checkedAt === null
  const bUnchecked = b.checkedAt === null
  if (aUnchecked !== bUnchecked) return aUnchecked ? -1 : 1

  if (!aUnchecked && !bUnchecked) {
    const diff = toMillis(b.checkedAt as string | Date) - toMillis(a.checkedAt as string | Date)
    if (diff !== 0) return diff
  }

  return toMillis(b.createdAt) - toMillis(a.createdAt)
}

export function sortItems<T extends SortableItem>(items: T[]): T[] {
  return [...items].sort(compareItems)
}
