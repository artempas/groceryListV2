'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface GroceryList {
  id: string
  name: string
  createdAt: string
  _count: { items: number }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pluralLists(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} список`
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} списка`
  return `${n} списков`
}

function pluralItems(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} позиция`
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} позиции`
  return `${n} позиций`
}

// ── API fetchers ─────────────────────────────────────────────────────────────

async function fetchLists(): Promise<GroceryList[]> {
  const res = await fetch('/api/lists')
  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = '/login'
      return []
    }
    throw new Error('Не удалось загрузить списки')
  }
  const json = await res.json()
  return json.data
}

async function createList(name: string): Promise<GroceryList> {
  const res = await fetch('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.error ?? 'Не удалось создать список')
  }
  const json = await res.json()
  // POST returns list without _count — normalise
  return { _count: { items: 0 }, ...json.data }
}

async function deleteList(id: string): Promise<void> {
  const res = await fetch(`/api/lists/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Не удалось удалить список')
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

// ── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-surface rounded-2xl border border-border px-4 py-4 flex items-center gap-3 animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-border rounded w-2/3" />
        <div className="h-3 bg-border rounded w-1/3" />
      </div>
      <div className="h-4 w-4 bg-border rounded" />
    </div>
  )
}

// ── Create modal ─────────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  isPending: boolean
}

function CreateModal({ open, onClose, onSubmit, isPending }: CreateModalProps) {
  const [name, setName] = useState('')

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  function handleClose() {
    setName('')
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="bg-surface rounded-t-2xl w-full max-w-lg p-6 pb-10">
        <h2 className="font-display font-bold text-xl text-brand mb-5">Новый список</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Название списка"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
              className="w-full rounded-xl border border-border px-4 py-3 text-[15px] text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-bg"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !name.trim()}
            className="w-full rounded-xl bg-brand text-white font-semibold text-[15px] py-3 disabled:opacity-50 active:opacity-80 transition-opacity"
          >
            {isPending ? 'Создание…' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="w-full text-center text-sm text-muted py-1"
          >
            Отмена
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ListsDashboard() {
  const router = useRouter()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)

  const { data: lists, isLoading, isError } = useQuery<GroceryList[]>({
    queryKey: ['lists'],
    queryFn: fetchLists,
  })

  const createMutation = useMutation({
    mutationFn: createList,
    onMutate: async (name: string) => {
      await qc.cancelQueries({ queryKey: ['lists'] })
      const previous = qc.getQueryData<GroceryList[]>(['lists'])
      const optimistic: GroceryList = {
        id: `optimistic-${Date.now()}`,
        name,
        createdAt: new Date().toISOString(),
        _count: { items: 0 },
      }
      qc.setQueryData<GroceryList[]>(['lists'], (old = []) => [optimistic, ...old])
      return { previous }
    },
    onError: (_err, _name, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['lists'], ctx.previous)
      }
    },
    onSuccess: (newList) => {
      // Replace the optimistic entry with the real one
      qc.setQueryData<GroceryList[]>(['lists'], (old = []) =>
        old.map((l) => (l.id.startsWith('optimistic-') ? newList : l)),
      )
      setModalOpen(false)
      router.push(`/lists/${newList.id}?name=${encodeURIComponent(newList.name)}`)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteList,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['lists'] })
      const previous = qc.getQueryData<GroceryList[]>(['lists'])
      qc.setQueryData<GroceryList[]>(['lists'], (old = []) => old.filter((l) => l.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(['lists'], ctx.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      window.location.href = '/login'
    },
  })

  function handleCreate(name: string) {
    createMutation.mutate(name)
  }

  const count = lists?.length ?? 0

  return (
    <>
      <div className="min-h-screen bg-bg">
        {/* Header */}
        <header className="px-5 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-brand tracking-tight">
              Мои списки
            </h1>
            {!isLoading && !isError && (
              <p className="text-sm text-muted mt-0.5">{pluralLists(count)}</p>
            )}
          </div>
          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="text-sm text-muted mt-1 disabled:opacity-50"
          >
            Выйти
          </button>
        </header>

        {/* Content */}
        <main className="px-5 pb-28">
          {isLoading && (
            <div className="space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {isError && (
            <p className="text-sm text-danger mt-4">Не удалось загрузить списки. Попробуйте снова.</p>
          )}

          {!isLoading && !isError && count === 0 && (
            <p className="text-sm text-muted mt-8 text-center leading-relaxed">
              У вас пока нет списков.{' '}Нажмите{' '}
              <span className="font-semibold text-brand">+</span> чтобы создать первый.
            </p>
          )}

          {!isLoading && !isError && count > 0 && (
            <div className="space-y-3">
              {lists!.map((list) => (
                <ListCard
                  key={list.id}
                  list={list}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === list.id}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* FAB */}
      <button
        onClick={() => setModalOpen(true)}
        aria-label="Создать список"
        className="fixed bottom-6 right-5 w-14 h-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Create modal */}
      <CreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
      />
    </>
  )
}

// ── List card sub-component ───────────────────────────────────────────────────

interface ListCardProps {
  list: GroceryList
  onDelete: (id: string) => void
  isDeleting: boolean
}

function ListCard({ list, onDelete, isDeleting }: ListCardProps) {
  const router = useRouter()
  const [pressTimer, setPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  function handlePointerDown() {
    const timer = setTimeout(() => {
      if (confirm(`Удалить список «${list.name}»?`)) {
        onDelete(list.id)
      }
    }, 600)
    setPressTimer(timer)
  }

  function handlePointerUp() {
    if (pressTimer) {
      clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }

  function handleClick() {
    if (!list.id.startsWith('optimistic-')) {
      router.push(`/lists/${list.id}?name=${encodeURIComponent(list.name)}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      disabled={isDeleting || list.id.startsWith('optimistic-')}
      className="w-full bg-surface rounded-2xl border border-border px-4 py-4 flex items-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60 text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[15px] text-text truncate">{list.name}</p>
        <p className="text-xs text-muted mt-0.5">{pluralItems(list._count.items)}</p>
      </div>
      {/* Chevron */}
      <svg
        className="text-muted shrink-0"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}
