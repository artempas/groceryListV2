'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })

      if (res.status === 201) {
        router.push('/')
        return
      }

      if (res.status === 409) {
        setError('Пользователь с таким email уже существует')
        return
      }

      if (res.status === 400) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? 'Ошибка регистрации')
        return
      }

      setError('Ошибка соединения')
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="max-w-sm mx-auto w-full px-7 flex flex-col justify-center min-h-screen">
        <div className="mb-12">
          <h1 className="font-display font-black text-5xl text-brand tracking-tighter leading-none mb-1.5">
            Покупки
          </h1>
          <p className="text-sm text-muted">Ваши списки всегда под рукой.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Имя"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
            <input
              type="password"
              placeholder="Пароль"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 text-[15px] outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand transition-colors placeholder:text-muted"
            />
          </div>

          {error && (
            <p className="mt-3 text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-white rounded-xl py-4 text-[15px] font-semibold mt-4 disabled:opacity-60 transition-opacity"
          >
            {loading ? 'Регистрируемся…' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="text-center text-[13px] text-muted mt-5">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-brand font-medium">
            Войти
          </Link>
        </p>
      </div>
    </div>
  )
}
