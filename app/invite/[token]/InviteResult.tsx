'use client'

import Link from 'next/link'

export function InviteError({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <div className="max-w-sm mx-auto w-full px-7 flex flex-col justify-center min-h-screen text-center">
        <h1 className="font-display font-bold text-2xl text-text mb-3">{title}</h1>
        <p className="text-sm text-muted mb-8 leading-relaxed">{message}</p>
        <Link
          href="/"
          className="bg-brand text-white rounded-xl py-3.5 text-[15px] font-semibold"
        >
          На главную
        </Link>
      </div>
    </div>
  )
}
