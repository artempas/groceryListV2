'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ListItem {
  id: string
  name: string
  listId: string
  createdAt: string
  checkedAt: string | null
  createdBy: { id: string; name: string }
  checkedBy: { id: string; name: string } | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}

// ── API fetchers ─────────────────────────────────────────────────────────────

function handleAccessLost(status: number) {
  if (status === 401) { window.location.href = '/login'; return true }
  if (status === 403 || status === 404) { window.location.href = '/lists'; return true }
  return false
}

async function fetchItems(listId: string): Promise<ListItem[]> {
  const res = await fetch(`/api/lists/${listId}/items`)
  if (!res.ok) {
    if (handleAccessLost(res.status)) return []
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось загрузить список')
  }
  const json = await res.json()
  return json.data
}

async function addItem(listId: string, name: string): Promise<ListItem> {
  const res = await fetch(`/api/lists/${listId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось добавить позицию')
  }
  const json = await res.json()
  return json.data
}

async function toggleItem(
  listId: string,
  itemId: string,
  checked: boolean,
): Promise<ListItem> {
  const res = await fetch(`/api/lists/${listId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось обновить позицию')
  }
  const json = await res.json()
  return json.data
}

async function deleteItem(listId: string, itemId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось удалить позицию')
  }
}

async function renameList(listId: string, name: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось переименовать')
  }
}

async function deleteList(listId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось удалить')
  }
}

async function leaveList(listId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/members/${userId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось выйти')
  }
}

interface MemberInfo {
  id: string
  name: string
  joinedAt: string
}

interface MembersResponse {
  owner: { id: string; name: string }
  members: MemberInfo[]
}

interface InviteInfo {
  token: string
  expiresAt: string
}

async function fetchMembers(listId: string): Promise<MembersResponse> {
  const res = await fetch(`/api/lists/${listId}/members`)
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось загрузить участников')
  }
  const json = await res.json()
  return json.data
}

async function createInvite(listId: string): Promise<InviteInfo> {
  const res = await fetch(`/api/lists/${listId}/invite`, { method: 'POST' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось создать ссылку')
  }
  const json = await res.json()
  return json.data
}

async function removeMember(listId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/lists/${listId}/members/${userId}`, { method: 'DELETE' })
  if (!res.ok) {
    if (handleAccessLost(res.status)) throw new Error('lost')
    throw new Error('Не удалось удалить участника')
  }
}

async function fetchMe(): Promise<{ id: string }> {
  const res = await fetch('/api/auth/me')
  if (!res.ok) throw new Error('Не удалось получить пользователя')
  const json = await res.json()
  return json.data
}

// ── Item row with swipe-to-delete ─────────────────────────────────────────────

interface ItemRowProps {
  item: ListItem
  onToggle: (item: ListItem) => void
  onDelete: (itemId: string) => void
  isToggling: boolean
}

function ItemRow({ item, onToggle, onDelete, isToggling }: ItemRowProps) {
  const isChecked = item.checkedAt !== null
  const [offset, setOffset] = useState(0)
  const [transitioning, setTransitioning] = useState(false)
  const startX = useRef<number | null>(null)
  const currentOffset = useRef(0)

  function handleTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
    setTransitioning(false)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) {
      const clamped = Math.max(dx, -120)
      currentOffset.current = clamped
      setOffset(clamped)
    }
  }

  function handleTouchEnd() {
    setTransitioning(true)
    if (currentOffset.current < -100) {
      onDelete(item.id)
    }
    currentOffset.current = 0
    setOffset(0)
    startX.current = null
  }

  const meta = isChecked
    ? `Купил ${item.checkedBy?.name ?? '—'} · ${formatRelative(item.checkedAt!)}`
    : `Добавил ${item.createdBy.name} · ${formatRelative(item.createdAt)}`

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Red delete background */}
      <div className="absolute inset-0 bg-danger rounded-2xl flex items-center justify-end pr-5 text-white text-sm font-semibold select-none">
        Удалить
      </div>

      {/* Item row */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: transitioning ? 'transform 0.25s ease' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={
          isChecked
            ? 'bg-checked-bg border border-transparent px-4 py-3 flex items-center gap-3'
            : 'bg-surface border border-border px-4 py-3 flex items-center gap-3'
        }
      >
        {/* Checkbox */}
        <button
          onClick={() => onToggle(item)}
          disabled={isToggling}
          aria-label={isChecked ? 'Снять отметку' : 'Отметить купленным'}
          className="flex-shrink-0 disabled:opacity-60"
        >
          {isChecked ? (
            <span className="w-6 h-6 rounded-full bg-brand flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <polyline
                  points="2,6 5,9 10,3"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full border-2 border-border block" />
          )}
        </button>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <p
            className={
              isChecked
                ? 'text-[15px] font-medium text-checked-text line-through'
                : 'text-[15px] font-medium text-text'
            }
          >
            {item.name}
          </p>
          <p className="text-[11px] text-muted mt-0.5">{meta}</p>
        </div>
      </div>
    </div>
  )
}

// ── Skeleton item ─────────────────────────────────────────────────────────────

function SkeletonItem() {
  return (
    <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-3 animate-pulse">
      <div className="w-6 h-6 rounded-full bg-border flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-border rounded w-3/5" />
        <div className="h-3 bg-border rounded w-2/5" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ListMeta {
  id: string
  name: string
  isOwner: boolean
  owner: { id: string; name: string }
}

async function fetchListMeta(listId: string): Promise<ListMeta> {
  const res = await fetch(`/api/lists/${listId}`)
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login'
      throw new Error('unauthorized')
    }
    if (res.status === 403 || res.status === 404) {
      window.location.href = '/lists'
      throw new Error('no-access')
    }
    throw new Error('Не удалось загрузить список')
  }
  const json = await res.json()
  return json.data
}

export default function ListDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const listId = params.id

  const { data: meta } = useQuery<ListMeta>({
    queryKey: ['list-meta', listId],
    queryFn: () => fetchListMeta(listId),
  })

  const listName = meta?.name ?? 'Список'

  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const { data: me } = useQuery<{ id: string }>({ queryKey: ['me'], queryFn: fetchMe })

  // ── Fetch items ──────────────────────────────────────────────────────────

  const { data: items, isLoading, isError } = useQuery<ListItem[]>({
    queryKey: ['items', listId],
    queryFn: () => fetchItems(listId),
  })

  // ── Add item mutation ────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: (name: string) => addItem(listId, name),
    onSuccess: (newItem) => {
      qc.setQueryData<ListItem[]>(['items', listId], (old = []) => [newItem, ...old])
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['items', listId] })
    },
  })

  // ── Toggle mutation (optimistic) ─────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, checked }: { itemId: string; checked: boolean }) =>
      toggleItem(listId, itemId, checked),
    onMutate: async ({ itemId, checked }) => {
      await qc.cancelQueries({ queryKey: ['items', listId] })
      const previous = qc.getQueryData<ListItem[]>(['items', listId])
      qc.setQueryData<ListItem[]>(['items', listId], (old = []) =>
        old.map((item) =>
          item.id === itemId
            ? {
                ...item,
                checkedAt: checked ? new Date().toISOString() : null,
                checkedBy: checked ? item.checkedBy : null,
              }
            : item,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['items', listId], ctx.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items', listId] })
    },
  })

  // ── Delete mutation (optimistic) ─────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => deleteItem(listId, itemId),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: ['items', listId] })
      const previous = qc.getQueryData<ListItem[]>(['items', listId])
      qc.setQueryData<ListItem[]>(['items', listId], (old = []) =>
        old.filter((item) => item.id !== itemId),
      )
      return { previous }
    },
    onError: (_err, _itemId, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['items', listId], ctx.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items', listId] })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  // ── Rename / Delete list / Leave mutations ───────────────────────────────

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameList(listId, name),
    onSuccess: (_void, name) => {
      qc.setQueryData<ListMeta>(['list-meta', listId], (old) => (old ? { ...old, name } : old))
      qc.invalidateQueries({ queryKey: ['lists'] })
      setRenameOpen(false)
    },
  })

  const deleteListMutation = useMutation({
    mutationFn: () => deleteList(listId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
      router.replace('/lists')
    },
  })

  const leaveMutation = useMutation({
    mutationFn: () => {
      if (!me) throw new Error('no user')
      return leaveList(listId, me.id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
      router.replace('/lists')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setInputValue('')
    addMutation.mutate(trimmed)
    inputRef.current?.focus()
  }

  function handleToggle(item: ListItem) {
    toggleMutation.mutate({ itemId: item.id, checked: item.checkedAt === null })
  }

  function handleDelete(itemId: string) {
    deleteMutation.mutate(itemId)
  }

  // ── Split items ───────────────────────────────────────────────────────────

  const unchecked = items?.filter((i) => i.checkedAt === null) ?? []
  const checked = items?.filter((i) => i.checkedAt !== null) ?? []

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Header */}
      <header className="bg-bg px-4 pt-5 pb-4 flex items-center gap-3 border-b border-border flex-shrink-0">
        <button
          onClick={() => router.push('/lists')}
          aria-label="Назад"
          className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="font-semibold text-[17px] text-text flex-1 truncate">{listName}</h1>
        {meta && (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Меню"
            className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-text"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        )}
      </header>

      {/* Scrollable items list */}
      <main className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-24">
        {isLoading && (
          <>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </>
        )}

        {isError && (
          <p className="text-sm text-danger mt-4 text-center">
            Не удалось загрузить позиции. Попробуйте снова.
          </p>
        )}

        {!isLoading && !isError && items !== undefined && (
          <>
            {/* Unchecked items */}
            {unchecked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
                isToggling={
                  toggleMutation.isPending &&
                  (toggleMutation.variables as { itemId: string } | undefined)?.itemId === item.id
                }
              />
            ))}

            {/* "Куплено (N)" divider — only shown when there are checked items */}
            {checked.length > 0 && (
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 py-2">
                Куплено ({checked.length})
              </p>
            )}

            {/* Checked items */}
            {checked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
                isToggling={
                  toggleMutation.isPending &&
                  (toggleMutation.variables as { itemId: string } | undefined)?.itemId === item.id
                }
              />
            ))}

            {/* Empty state */}
            {items.length === 0 && (
              <p className="text-sm text-muted mt-8 text-center leading-relaxed">
                В этом списке пока ничего нет.{' '}
                <br />
                Добавьте первую позицию ниже.
              </p>
            )}
          </>
        )}
      </main>

      {/* Fixed add-item bar */}
      <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-border px-4 py-3 flex gap-3">
        <form onSubmit={handleSubmit} className="flex gap-3 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Добавить позицию…"
            maxLength={200}
            className="flex-1 bg-bg border border-border rounded-xl px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || addMutation.isPending}
            aria-label="Добавить"
            className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white disabled:opacity-50 flex-shrink-0"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </form>
      </div>

      {/* Overflow menu sheet */}
      {menuOpen && meta && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMenuOpen(false)
          }}
        >
          <div className="bg-surface rounded-t-2xl w-full max-w-lg p-2 pb-6">
            {meta.isOwner ? (
              <>
                <MenuButton
                  label="Пригласить"
                  onClick={() => {
                    setMenuOpen(false)
                    setShareOpen(true)
                  }}
                />
                <MenuButton
                  label="Переименовать"
                  onClick={() => {
                    setMenuOpen(false)
                    setRenameOpen(true)
                  }}
                />
                <MenuButton
                  label="Удалить"
                  danger
                  onClick={() => {
                    if (confirm(`Удалить список «${meta.name}»?`)) {
                      setMenuOpen(false)
                      deleteListMutation.mutate()
                    }
                  }}
                />
              </>
            ) : (
              <MenuButton
                label="Выйти"
                danger
                onClick={() => {
                  if (confirm(`Покинуть список «${meta.name}»?`)) {
                    setMenuOpen(false)
                    leaveMutation.mutate()
                  }
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="w-full text-center text-sm text-muted py-3 mt-1"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Rename sheet */}
      {renameOpen && meta && (
        <RenameSheet
          initialName={meta.name}
          isPending={renameMutation.isPending}
          onClose={() => setRenameOpen(false)}
          onSubmit={(name) => renameMutation.mutate(name)}
        />
      )}

      {/* Share sheet */}
      {shareOpen && meta?.isOwner && (
        <ShareSheet
          listId={listId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  )
}

// ── Helper components ─────────────────────────────────────────────────────────

function MenuButton({
  label,
  onClick,
  danger = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? 'w-full text-left px-4 py-3.5 text-[15px] font-medium text-danger rounded-xl active:bg-bg'
          : 'w-full text-left px-4 py-3.5 text-[15px] font-medium text-text rounded-xl active:bg-bg'
      }
    >
      {label}
    </button>
  )
}

function ShareSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

  const { data: invite, isLoading: inviteLoading, isError: inviteError } = useQuery({
    queryKey: ['invite', listId],
    queryFn: () => createInvite(listId),
    staleTime: Infinity,
  })

  const { data: members } = useQuery({
    queryKey: ['members', listId],
    queryFn: () => fetchMembers(listId),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(listId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', listId] }),
  })

  const inviteUrl = invite ? `${window.location.origin}/invite/${invite.token}` : ''
  const expiresText = invite
    ? new Date(invite.expiresAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  async function handleCopy() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: user can manually copy from the visible input
    }
  }

  function handleRemove(member: MemberInfo) {
    if (confirm(`Удалить ${member.name} из списка?`)) {
      removeMutation.mutate(member.id)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10 max-h-[90vh] overflow-y-auto">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Поделиться списком</h2>

        {/* Link section */}
        <div className="mb-6">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Ссылка
          </p>
          {inviteError ? (
            <p className="text-sm text-danger">Не удалось получить ссылку. Попробуйте закрыть и открыть шторку.</p>
          ) : inviteLoading ? (
            <div className="h-12 bg-bg rounded-xl animate-pulse" />
          ) : (
            <>
              <p className="text-xs text-muted mb-2">Действует до {expiresText}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-bg border border-border rounded-xl px-3 py-2.5 text-[13px] text-text outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold"
                >
                  {copied ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Members section */}
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Участники
          </p>
          {members ? (
            <div className="space-y-2">
              <div className="flex items-center bg-bg border border-border rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-text truncate">{members.owner.name}</p>
                  <p className="text-[11px] text-muted">владелец</p>
                </div>
              </div>
              {members.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center bg-bg border border-border rounded-xl px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-text truncate">{m.name}</p>
                    <p className="text-[11px] text-muted">
                      присоединился {new Date(m.joinedAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={removeMutation.isPending && removeMutation.variables === m.id}
                    aria-label={`Удалить ${m.name}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-muted active:bg-border disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-12 bg-bg rounded-xl animate-pulse" />
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-center text-sm text-muted py-2"
        >
          Закрыть
        </button>
      </div>
    </div>
  )
}

function RenameSheet({
  initialName,
  isPending,
  onClose,
  onSubmit,
}: {
  initialName: string
  isPending: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialName) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Переименовать</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={100}
            className="w-full rounded-xl border border-border px-4 py-3 text-[15px] text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-bg"
          />
          <button
            type="submit"
            disabled={isPending || !name.trim() || name.trim() === initialName}
            className="w-full rounded-xl bg-brand text-white font-semibold text-[15px] py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
          >
            {isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-center text-sm text-muted py-1"
          >
            Отмена
          </button>
        </form>
      </div>
    </div>
  )
}
