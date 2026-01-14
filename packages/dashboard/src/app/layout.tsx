import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Klaas Dashboard',
  description: 'Remote access and control for Claude Code sessions',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
}

export const viewport: Viewport = {
  themeColor: '#7c3aed',
  width: 'device-width',
  initialScale: 1,
}

/**
 * Root layout for the Klaas Dashboard application.
 * Sets up the HTML document with Inter font and dark mode support.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} bg-gray-50 dark:bg-gray-900`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  )
}
