'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        router.push('/')
        return
      }

      if (res.status === 401) {
        setError('Неверный email или пароль')
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
              autoComplete="current-password"
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
            {loading ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <p className="text-center text-[13px] text-muted mt-5">
          Нет аккаунта?{' '}
          <Link href="/register" className="text-brand font-medium">
            Зарегистрироваться
          </Link>
        </p>
      </div>
    </div>
  )
}
