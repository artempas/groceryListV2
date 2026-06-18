import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import Providers from './providers'

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['700', '900'],
  variable: '--font-fraunces',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Списки покупок',
  description: 'Ваши личные списки покупок',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Покупки',
  },
}

export const viewport: Viewport = {
  themeColor: '#1A3A2A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="font-ui bg-bg text-text antialiased">
        <Providers>{children}</Providers>
        <Script src="/sw-register.js" strategy="afterInteractive" />
      </body>
    </html>
  )
}
