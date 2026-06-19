import { emitListEvent, subscribeListEvents, type ListEvent } from '@/lib/list-events'

function addedEvent(listId: string, id: string): ListEvent {
  return {
    type: 'item.added',
    listId,
    originClientId: null,
    payload: {
      id, name: 'Milk', category: null, listId,
      createdAt: '2026-06-19T00:00:00.000Z', checkedAt: null,
      createdBy: { id: 'u1', name: 'A' }, checkedBy: null,
    },
  }
}

describe('list-events bus', () => {
  it('delivers an emitted event to a subscriber of the same list', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    emitListEvent('list-1', addedEvent('list-1', 'item-1'))
    unsub()
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('item.added')
  })

  it('does not deliver events from a different list', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    emitListEvent('list-2', addedEvent('list-2', 'item-2'))
    unsub()
    expect(received).toHaveLength(0)
  })

  it('stops delivering after unsubscribe', () => {
    const received: ListEvent[] = []
    const unsub = subscribeListEvents('list-1', (e) => received.push(e))
    unsub()
    emitListEvent('list-1', addedEvent('list-1', 'item-3'))
    expect(received).toHaveLength(0)
  })
})
