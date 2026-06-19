# Optimistic UI for adding list items

## Problem

Adding an item to a list is slow: the `POST /api/lists/[id]/items` handler
`await`s `categorize()`, which calls an LLM (via OpenRouter embeddings) to assign
a category before the row is persisted and returned. The current frontend
`addMutation` only inserts the new row into the cache in `onSuccess`, so the user
sees nothing happen until the LLM round-trip finishes. This violates optimistic
UI principles — the interface should respond to the user's action immediately.

## Goal

Make the new item appear instantly when the user submits, then reconcile with the
server's authoritative row (which carries the real category) once the request
resolves. The server (`POST` handler and `categorize()`) is unchanged — this is a
frontend-only behavior change.

## Scope

All changes are in `app/(app)/lists/[id]/page.tsx`. No API, schema, or
`lib/` changes.

## Design

### Types

- Widen the `me` query's type from `{ id: string }` to `{ id: string; name: string }`.
  The `/api/auth/me` endpoint already returns `name`; we need it to populate
  `createdBy` on the optimistic row.
- Add an optional field `pending?: boolean` to the `ListItem` interface. It is set
  only on the locally-created optimistic row and is never sent by the server. It
  drives the in-flight indicator and disables interactions on the temp row.

### `addMutation` — convert to optimistic

Follow the same pattern already used by `toggleMutation` and `deleteMutation`.

- `onMutate(name)`:
  - `await qc.cancelQueries({ queryKey: ['items', listId] })`
  - snapshot `previous = qc.getQueryData(['items', listId])`
  - generate `tempId = 'temp-' + crypto.randomUUID()`
  - prepend a temp `ListItem` to the cache:
    - `id: tempId`
    - `name`
    - `category: null`  → lands in the "Без категории" group
    - `listId`
    - `createdAt: new Date().toISOString()`
    - `checkedAt: null`
    - `createdBy: { id: me.id, name: me.name }` (fall back gracefully if `me` is
      undefined — see Edge cases)
    - `checkedBy: null`
    - `pending: true`
  - return `{ previous, tempId }`
- `onSuccess(newItem, _name, ctx)`:
  - replace the cached row whose `id === ctx.tempId` with the real `newItem`
    (real category, no `pending` flag)
  - `qc.invalidateQueries({ queryKey: ['lists'] })`
  - **Do NOT** invalidate/refetch `['items', listId]`. A refetch here would drop
    other concurrent in-flight temp rows (not yet persisted) until their own
    `onSuccess`, causing them to flicker out and back.
- `onError(name, _vars, ctx)`:
  - roll back: `if (ctx?.previous !== undefined) qc.setQueryData(['items', listId], ctx.previous)`
    (this removes the temp row)
  - restore the input so the user's text isn't lost: set `inputValue` back to
    `name` (only if the input is currently empty, to avoid clobbering text the
    user has since started typing)

### Submit handler / button

- In `handleSubmit`, keep clearing the input immediately and calling
  `addMutation.mutate(trimmed)`.
- Remove `addMutation.isPending` from the submit button's `disabled` expression,
  leaving just `!inputValue.trim()`. This lets the user queue several items in
  quick succession without waiting for each LLM round-trip — the point of
  optimistic UI. Multiple concurrent `addMutation` calls each carry their own
  `tempId` via mutation context, so they reconcile independently.

### `ItemRow` — pending state

The optimistic row's `id` is temporary, so it cannot be toggled or deleted
server-side until reconciled. While `item.pending` is true:

- Render a small spinner together with meta text "Определяем категорию…" in place
  of the normal meta line.
- Disable the checkbox button.
- Disable swipe-to-delete (skip the touch handlers / the `onDelete` call when
  `item.pending`).

## Known behavior / tradeoff

Because the category is unknown at insertion time, the row first appears in the
"Без категории" group and then visibly moves to its real category group when the
server responds. Framer-motion's `layout` animation makes this a smooth move, and
the "Определяем категорию…" spinner explains why the row shifts.

## Edge cases

- **`me` not yet loaded:** if the `me` query hasn't resolved, fall back to a
  neutral name (e.g. empty string / "Вы") for the optimistic `createdBy`. The real
  `createdBy` arrives with `newItem` in `onSuccess`, so this is only a momentary
  display value.
- **Concurrent adds:** each `addMutation.mutate` call gets its own `onMutate`
  context with a unique `tempId`; `onSuccess`/`onError` use `ctx.tempId`, so rows
  reconcile independently and no refetch wipes pending siblings.
- **Toggle/delete on a pending row:** prevented at the UI level (disabled controls)
  so no request is ever sent with a `temp-` id.

## Testing

- Unit/interaction test (React Testing Library, the project's existing stack):
  submitting the form inserts a row immediately (before the POST resolves) showing
  the pending indicator; once the mocked POST resolves, the row shows the real
  category and the indicator is gone.
- Error path: a failing POST removes the optimistic row and restores the input
  text.
