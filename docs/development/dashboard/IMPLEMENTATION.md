# Nexo Dashboard Implementation Guide

This document provides a comprehensive implementation guide for the Nexo
Dashboard application. The dashboard is based on the RedirMe.com dashboard
patterns and architecture.

## Overview

The Nexo Dashboard allows users to:
- Log in to their account
- View all their Claude Code sessions
- Connect to active sessions via a terminal interface
- Send and receive messages in real-time

## Technology Stack

- **Framework**: Next.js 15 with App Router
- **Styling**: TailwindCSS 4
- **State Management**: Zustand
- **Data Tables**: TanStack React Table
- **Terminal**: xterm.js with WebSocket backend
- **Icons**: Lucide React
- **Forms**: React Hook Form with Zod validation
- **JWT**: jose library

## Directory Structure

```
packages/dashboard/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── login/
│   │   │   ├── page.tsx          # Server component wrapper
│   │   │   └── page-client.tsx   # Client login page
│   │   ├── (dashboard)/          # Protected routes
│   │   │   ├── layout.tsx        # Server layout wrapper
│   │   │   ├── layout-client.tsx # Client layout with sidebar/header
│   │   │   ├── page.tsx          # Dashboard home (redirects to sessions)
│   │   │   └── sessions/
│   │   │       ├── page.tsx      # Sessions overview
│   │   │       └── [id]/
│   │   │           └── page.tsx  # Session detail with terminal
│   │   ├── globals.css           # Global styles
│   │   ├── layout.tsx            # Root layout
│   │   └── not-found.tsx         # 404 page
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   └── login-form.tsx    # Login form (copy from RedirMe)
│   │   ├── layout/
│   │   │   ├── header.tsx        # Sticky header
│   │   │   ├── sidebar.tsx       # Collapsible sidebar
│   │   │   ├── mobile-drawer.tsx # Mobile menu
│   │   │   └── navigation-config.ts
│   │   ├── sessions/
│   │   │   └── terminal.tsx      # xterm.js terminal component
│   │   ├── ui/
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── empty-state.tsx
│   │   │   ├── error-display.tsx
│   │   │   └── data-table/
│   │   │       ├── data-table.tsx
│   │   │       ├── data-table-header.tsx
│   │   │       ├── data-table-pagination.tsx
│   │   │       ├── data-table-column-header.tsx
│   │   │       ├── types.ts
│   │   │       └── index.ts
│   │   ├── providers/
│   │   │   └── toast-provider.tsx
│   │   └── icons/
│   │       └── app-icon.tsx
│   │
│   ├── hooks/
│   │   └── use-auth.ts           # Zustand auth store
│   │
│   ├── lib/
│   │   ├── api-client.ts         # Base API client
│   │   ├── dashboard-api.ts      # Dashboard API service
│   │   ├── utils.ts              # Utility functions
│   │   └── date-utils.ts         # Date formatting
│   │
│   ├── types/
│   │   ├── auth.ts               # Auth types
│   │   └── session.ts            # Session types
│   │
│   └── middleware.ts             # Auth middleware
│
├── public/                       # Static assets
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── wrangler.toml                 # Cloudflare Pages config
```

## Phase 1: Project Setup

### 1.1 Create Package

```bash
mkdir -p packages/dashboard
cd packages/dashboard
```

### 1.2 package.json

```json
{
  "name": "@nexo/dashboard",
  "version": "0.1.0",
  "private": true,
  "description": "Nexo User Dashboard",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "build:cf": "npm run clean && opennextjs-cloudflare build",
    "clean": "rm -rf .next .open-next",
    "deploy:staging": "npm run build:cf && wrangler deploy --env staging",
    "deploy:production": "npm run build:cf && wrangler deploy --env production",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:once": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-table": "^8.21.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "clsx": "^2.1.1",
    "jose": "^6.0.0",
    "lucide-react": "^0.515.0",
    "next": "15.3.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.54.0",
    "zod": "^3.24.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@opennextjs/cloudflare": "^1.2.0",
    "@tailwindcss/postcss": "^4.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^15.0.0",
    "postcss": "^8.5.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

### 1.3 Environment Variables

Create `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8787
```

## Phase 2: Authentication

### 2.1 Login Form Component

Copy the login form from RedirMe.com verbatim. The login form handles:
- Email/password input
- MFA verification (6-digit code input)
- Backup code fallback
- Auto-submit on complete MFA code
- Error handling
- Redirect after login

**Source**: `redirme.com/packages/dashboard/src/components/auth/login-form.tsx`

Key changes for Nexo:
- Replace `redirme-user-token` with `nexo-user-token`
- Update branding/colors from purple to match Nexo theme
- Remove tracking calls (`setUetUserIdentity`)
- Remove guest user ID handling

### 2.2 Auth Hook (Zustand Store)

```typescript
// src/hooks/use-auth.ts
'use client'

import { create } from 'zustand'
import { apiClient } from '../lib/api-client'
import type { LoginCredentials } from '../types/auth'

interface LoginResult {
  success: boolean
  token?: string
  requiresMFA?: boolean
}

interface AuthState {
  isAuthenticated: boolean
  email: string | null
  isLoading: boolean
  hasHydrated: boolean
  login: (credentials: LoginCredentials) => Promise<LoginResult>
  logout: () => Promise<void>
  initialize: () => Promise<void>
  checkAuth: () => Promise<boolean>
  setHydrated: () => void
}

export const useAuth = create<AuthState>()(set => ({
  isAuthenticated: false,
  email: null,
  isLoading: true,
  hasHydrated: false,

  setHydrated: (): void => set({ hasHydrated: true }),

  login: async (credentials: LoginCredentials): Promise<LoginResult> => {
    try {
      const result = await apiClient.login(credentials)

      if (result.requiresMFA) {
        return result
      }

      if (result.success && result.token) {
        set({
          isAuthenticated: true,
          email: credentials.email
        })
        return result
      }
      throw new Error('Login failed')
    } catch (error) {
      set({ isAuthenticated: false, email: null })
      throw error
    }
  },

  logout: async (): Promise<void> => {
    try {
      await apiClient.logout()
    } catch {
      // Silently handle logout errors
    }
    set({ isAuthenticated: false, email: null })
  },

  initialize: async (): Promise<void> => {
    const hasToken = localStorage.getItem('nexo-user-token')
    if (!hasToken) {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false,
        hasHydrated: true
      })
      return
    }

    try {
      const authResult = await apiClient.checkAuth()
      set({
        isAuthenticated: authResult.authenticated,
        email: authResult.email || null,
        isLoading: false,
        hasHydrated: true
      })
    } catch {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false,
        hasHydrated: true
      })
    }
  },

  checkAuth: async (): Promise<boolean> => {
    try {
      const authResult = await apiClient.checkAuth()
      set({
        isAuthenticated: authResult.authenticated,
        email: authResult.email || null,
        isLoading: false
      })
      return authResult.authenticated
    } catch {
      set({
        isAuthenticated: false,
        email: null,
        isLoading: false
      })
      return false
    }
  },
}))
```

### 2.3 API Client

```typescript
// src/lib/api-client.ts
import type { LoginCredentials } from '@/types/auth'

interface LoginResponse {
  success: boolean
  token?: string
  requiresMFA?: boolean
}

interface AuthCheckResponse {
  authenticated: boolean
  email?: string
}

class ApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
  }

  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await fetch(
      `${this.baseUrl}/dashboard/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(credentials),
      }
    )

    const result = await response.json()

    // Handle MFA requirement
    if (response.status === 401 && result.error === 'MFA token required') {
      return { success: false, requiresMFA: true }
    }

    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`)
    }

    if (result.success && result.data?.token) {
      localStorage.setItem('nexo-user-token', result.data.token)

      // Set cookie for middleware
      const isHttps = window.location.protocol === 'https:'
      const secureFlag = isHttps ? '; secure' : ''
      const cookieOptions = `path=/; max-age=${60 * 60 * 24}; ` +
        `samesite=strict${secureFlag}`
      document.cookie = `nexo-user-token=${result.data.token}; ${cookieOptions}`

      return { success: true, token: result.data.token }
    }

    throw new Error(result.error || 'Login failed')
  }

  async logout(): Promise<void> {
    localStorage.removeItem('nexo-user-token')
    const isHttps = window.location.protocol === 'https:'
    const secureFlag = isHttps ? '; secure' : ''
    document.cookie = 'nexo-user-token=; path=/; ' +
      `expires=Thu, 01 Jan 1970 00:00:01 GMT; samesite=strict${secureFlag}`
  }

  async checkAuth(): Promise<AuthCheckResponse> {
    const token = localStorage.getItem('nexo-user-token')
    if (!token) {
      return { authenticated: false }
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/dashboard/auth/check`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include'
        }
      )

      if (response.ok) {
        return { authenticated: true }
      }
      localStorage.removeItem('nexo-user-token')
      return { authenticated: false }
    } catch {
      localStorage.removeItem('nexo-user-token')
      return { authenticated: false }
    }
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem('nexo-user-token')
    const url = `${this.baseUrl}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
      },
      credentials: 'include'
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP ${response.status}`)
    }

    return response.json()
  }
}

export const apiClient = new ApiClient()
```

## Phase 3: Dashboard Layout

### 3.1 Layout Structure

The dashboard uses a fixed header and collapsible sidebar pattern:

```typescript
// src/app/(dashboard)/layout-client.tsx
'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { MobileDrawer } from '@/components/layout/mobile-drawer'
import { ToastProvider } from '@/components/ui/toast'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const router = useRouter()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('nexo-user-token')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSidebarCollapsed(
        localStorage.getItem('sidebarCollapsed') === 'true'
      )
    }
  }, [])

  const headerMarginClass = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-64'
  const contentMarginClass = sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-64'

  return (
    <ToastProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <MobileDrawer
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
        <div className={`fixed top-0 right-0 left-0 transition-all
          duration-300 ${headerMarginClass} z-40`}>
          <Header onMenuClick={() => setMobileMenuOpen(true)} />
        </div>
        <div className={`transition-all duration-300 pt-[73px]
          ${contentMarginClass}`}>
          <main className="px-4 py-4 sm:px-6">
            <div className="w-full">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  )
}
```

### 3.2 Header Component

```typescript
// src/components/layout/header.tsx
'use client'

import React, { useState, useEffect } from 'react'
import { Sun, Moon, User, ChevronDown, Menu } from 'lucide-react'

const DARK_MODE_KEY = 'nexo-dashboard-dark-mode'

interface HeaderProps {
  onMenuClick?: () => void
}

export function Header({ onMenuClick }: HeaderProps): React.JSX.Element {
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  useEffect(() => {
    const savedPreference = localStorage.getItem(DARK_MODE_KEY)
    if (savedPreference !== null) {
      const prefersDark = savedPreference === 'true'
      setIsDarkMode(prefersDark)
      document.documentElement.classList.toggle('dark', prefersDark)
    } else {
      const systemPrefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
      setIsDarkMode(systemPrefersDark)
      document.documentElement.classList.toggle('dark', systemPrefersDark)
    }
  }, [])

  const toggleDarkMode = (): void => {
    const newValue = !isDarkMode
    setIsDarkMode(newValue)
    localStorage.setItem(DARK_MODE_KEY, String(newValue))
    document.documentElement.classList.toggle('dark', newValue)
  }

  return (
    <header className="h-[73px] backdrop-blur-sm bg-opacity-80 flex
      items-center bg-white dark:bg-gray-800 border-b
      border-gray-200 dark:border-gray-700 px-6">
      {/* Mobile menu button, dark mode toggle, user menu */}
    </header>
  )
}
```

### 3.3 Navigation Configuration

```typescript
// src/components/layout/navigation-config.ts
import { Terminal } from 'lucide-react'

export const navigationItems = [
  {
    name: 'Sessions',
    href: '/sessions',
    icon: Terminal,
  },
]

export const footerNavigationItems = []
```

## Phase 4: Sessions Overview

### 4.1 Sessions Page

```typescript
// src/app/(dashboard)/sessions/page.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { dashboardApi } from '@/lib/dashboard-api'
import {
  Terminal,
  Clock,
  Monitor,
  Smartphone,
  Eye,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ErrorDisplay } from '@/components/ui/error-display'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

interface Session {
  id: string
  deviceName: string
  deviceType: 'cli' | 'web'
  status: 'active' | 'idle' | 'disconnected'
  lastActivityAt: string
  createdAt: string
  cwd: string
}

export default function SessionsPage(): React.JSX.Element {
  const router = useRouter()
  const { addToast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastActivityAt', desc: true }
  ])

  const pageSize = 20

  const loadSessions = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await dashboardApi.getSessions({
        page: pageIndex + 1,
        limit: pageSize,
        search: searchTerm || undefined,
      })
      setSessions(response.data)
      setPageCount(response.meta.totalPages)
      setTotal(response.meta.total)
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to load sessions'
      setError(errorMessage)
      setSessions([])
    } finally {
      setIsLoading(false)
    }
  }, [pageIndex, searchTerm])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const columns: ColumnDef<Session, unknown>[] = [
    {
      id: 'device',
      accessorFn: (row) => row.deviceName,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Device" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.deviceType === 'cli' ? (
            <Monitor className="h-5 w-5 text-gray-400" />
          ) : (
            <Smartphone className="h-5 w-5 text-gray-400" />
          )}
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              {row.original.deviceName}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400
              font-mono truncate max-w-[200px]">
              {row.original.cwd}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.original.status
        const variant = status === 'active' ? 'success'
          : status === 'idle' ? 'warning' : 'default'
        return (
          <Badge variant={variant}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        )
      },
    },
    {
      id: 'lastActivityAt',
      accessorKey: 'lastActivityAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Last Activity" />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-sm text-gray-600
          dark:text-gray-400">
          <Clock className="h-4 w-4" />
          {formatRelativeTime(row.original.lastActivityAt)}
        </div>
      ),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Started" />
      ),
      cell: ({ row }) => (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {formatDateTime(row.original.createdAt)}
        </div>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="text-xs font-medium uppercase tracking-wider
          text-gray-500 dark:text-gray-400">
          Actions
        </span>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => router.push(`/sessions/${row.original.id}`)}
            className="p-1 text-gray-400 hover:text-blue-600
              dark:hover:text-blue-400"
            title="View session"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDeleteSession(row.original.id)}
            className="p-1 text-gray-400 hover:text-red-600
              dark:hover:text-red-400"
            title="End session"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ]

  const handleDeleteSession = async (id: string): Promise<void> => {
    try {
      await dashboardApi.deleteSession(id)
      addToast({
        title: 'Session Ended',
        description: 'The session has been terminated',
        type: 'success'
      })
      loadSessions()
    } catch {
      addToast({
        title: 'Error',
        description: 'Failed to end session',
        type: 'error'
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center
        sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900
            dark:text-white">
            Sessions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View and manage your Claude Code sessions
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <ErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {/* Sessions Table */}
      <DataTable
        data={sessions}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Search sessions..."
        searchValue={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value)
          setPageIndex(0)
        }}
        sorting={sorting}
        onSortingChange={setSorting}
        pageCount={pageCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPaginationChange={({ pageIndex: newPage }) => setPageIndex(newPage)}
        totalCount={total}
        onRowClick={(row) => router.push(`/sessions/${row.id}`)}
        emptyMessage="No sessions found"
        emptyDescription="Start a Claude Code session using the CLI"
      />
    </div>
  )
}
```

## Phase 5: Session Detail with Terminal

### 5.1 Session Detail Page

```typescript
// src/app/(dashboard)/sessions/[id]/page.tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Circle, Monitor, Clock } from 'lucide-react'
import { dashboardApi } from '@/lib/dashboard-api'
import { Terminal } from '@/components/sessions/terminal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatDateTime } from '@/lib/date-utils'

interface Session {
  id: string
  deviceName: string
  deviceType: 'cli' | 'web'
  status: 'active' | 'idle' | 'disconnected'
  lastActivityAt: string
  createdAt: string
  cwd: string
}

export default function SessionDetailPage(): React.JSX.Element {
  const router = useRouter()
  const params = useParams()
  const { addToast } = useToast()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sessionId = params.id as string

  useEffect(() => {
    async function loadSession(): Promise<void> {
      try {
        const result = await dashboardApi.getSessionById(sessionId)
        setSession(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session')
      } finally {
        setLoading(false)
      }
    }
    loadSession()
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-blue-600
          border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400">
          {error || 'Session not found'}
        </p>
        <Button onClick={() => router.push('/sessions')} className="mt-4">
          Back to Sessions
        </Button>
      </div>
    )
  }

  const statusColor = session.status === 'active' ? 'text-green-500'
    : session.status === 'idle' ? 'text-yellow-500' : 'text-gray-400'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/sessions')}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400
            dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
            rounded-lg transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {session.deviceName}
            </h1>
            <Badge variant={
              session.status === 'active' ? 'success'
                : session.status === 'idle' ? 'warning' : 'default'
            }>
              <Circle className={`h-2 w-2 mr-1 fill-current ${statusColor}`} />
              {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            </Badge>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">
            {session.cwd}
          </p>
        </div>
      </div>

      {/* Session Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Monitor className="h-4 w-4" />
            Device Type
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white">
            {session.deviceType === 'cli' ? 'CLI' : 'Web'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border
          border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500
            dark:text-gray-400 text-sm">
            <Clock className="h-4 w-4" />
            Started
          </div>
          <p className="mt-1 font-medium text-gray-900 dark:text-white">
            {formatDateTime(session.createdAt)}
          </p>
        </div>
      </div>

      {/* Terminal */}
      <div className="bg-gray-900 rounded-lg overflow-hidden border
        border-gray-700">
        <div className="px-4 py-2 bg-gray-800 border-b border-gray-700
          flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
          </div>
          <span className="text-sm text-gray-400 ml-2">
            Claude Code Session
          </span>
        </div>
        <Terminal
          sessionId={sessionId}
          onDisconnect={() => {
            addToast({
              title: 'Disconnected',
              description: 'Terminal connection lost',
              type: 'warning'
            })
          }}
        />
      </div>
    </div>
  )
}
```

### 5.2 Terminal Component with xterm.js

```typescript
// src/components/sessions/terminal.tsx
'use client'

import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  sessionId: string
  onDisconnect?: () => void
}

export function Terminal({
  sessionId,
  onDisconnect
}: TerminalProps): React.JSX.Element {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize xterm.js
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#f0f0f0',
        cursor: '#f0f0f0',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    term.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Connect to WebSocket
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
    const wsUrl = apiUrl.replace(/^http/, 'ws')
    const token = localStorage.getItem('nexo-user-token')

    const ws = new WebSocket(
      `${wsUrl}/dashboard/sessions/${sessionId}/terminal?token=${token}`
    )

    ws.onopen = () => {
      term.writeln('\x1b[32mConnected to session\x1b[0m')
      term.writeln('')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'output') {
        term.write(data.content)
      } else if (data.type === 'clear') {
        term.clear()
      }
    }

    ws.onclose = () => {
      term.writeln('')
      term.writeln('\x1b[31mDisconnected from session\x1b[0m')
      onDisconnect?.()
    }

    ws.onerror = () => {
      term.writeln('\x1b[31mConnection error\x1b[0m')
    }

    wsRef.current = ws

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', content: data }))
      }
    })

    // Handle resize
    const handleResize = (): void => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows
        }))
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      ws.close()
      term.dispose()
    }
  }, [sessionId, onDisconnect])

  return (
    <div
      ref={terminalRef}
      className="h-[500px] w-full"
    />
  )
}
```

## Phase 6: API Endpoints

### 6.1 Dashboard API Routes

Add these routes to the API package under `/dashboard`:

```typescript
// packages/api/src/routes/dashboard.ts

// Authentication
POST /dashboard/auth/login       // User login
GET  /dashboard/auth/check       // Check auth status

// Sessions
GET    /dashboard/sessions                    // List user's sessions
GET    /dashboard/sessions/:id                // Get session details
DELETE /dashboard/sessions/:id                // End session
WS     /dashboard/sessions/:id/terminal       // WebSocket terminal
```

### 6.2 Dashboard API Implementation

```typescript
// packages/api/src/routes/dashboard/sessions.ts
import { Hono } from 'hono'
import type { Env } from '../../types'
import { userAuthMiddleware } from '../../middleware/user-auth'

const sessionsRoutes = new Hono<{
  Bindings: Env
  Variables: { userId: string }
}>()

// Apply auth middleware
sessionsRoutes.use('*', userAuthMiddleware)

/**
 * GET /dashboard/sessions - List user's sessions
 */
sessionsRoutes.get('/', async (c) => {
  const userId = c.get('userId')
  const page = parseInt(c.req.query('page') || '1', 10)
  const limit = parseInt(c.req.query('limit') || '20', 10)
  const search = c.req.query('search')

  const offset = (page - 1) * limit

  let query = `
    SELECT id, device_name, device_type, status, last_activity_at,
           created_at, cwd
    FROM sessions
    WHERE user_id = ?
  `
  const params: (string | number)[] = [userId]

  if (search) {
    query += ` AND (device_name LIKE ? OR cwd LIKE ?)`
    params.push(`%${search}%`, `%${search}%`)
  }

  query += ` ORDER BY last_activity_at DESC LIMIT ? OFFSET ?`
  params.push(limit, offset)

  const stmt = c.env.DB.prepare(query)
  const result = await stmt.bind(...params).all()

  // Get total count
  const countStmt = c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM sessions WHERE user_id = ?'
  )
  const countResult = await countStmt.bind(userId).first<{ count: number }>()
  const total = countResult?.count || 0

  return c.json({
    success: true,
    data: result.results.map(row => ({
      id: row.id,
      deviceName: row.device_name,
      deviceType: row.device_type,
      status: row.status,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      cwd: row.cwd,
    })),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  })
})

/**
 * GET /dashboard/sessions/:id - Get session details
 */
sessionsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('id')

  const stmt = c.env.DB.prepare(`
    SELECT id, device_name, device_type, status, last_activity_at,
           created_at, cwd
    FROM sessions
    WHERE id = ? AND user_id = ?
  `)
  const result = await stmt.bind(sessionId, userId).first()

  if (!result) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json({
    success: true,
    data: {
      id: result.id,
      deviceName: result.device_name,
      deviceType: result.device_type,
      status: result.status,
      lastActivityAt: result.last_activity_at,
      createdAt: result.created_at,
      cwd: result.cwd,
    }
  })
})

/**
 * DELETE /dashboard/sessions/:id - End session
 */
sessionsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const sessionId = c.req.param('id')

  const stmt = c.env.DB.prepare(`
    UPDATE sessions SET status = 'disconnected'
    WHERE id = ? AND user_id = ?
  `)
  await stmt.bind(sessionId, userId).run()

  return c.json({ success: true })
})

export { sessionsRoutes }
```

### 6.3 User Auth Middleware

```typescript
// packages/api/src/middleware/user-auth.ts
import type { Context, Next } from 'hono'
import type { Env } from '../types'
import { verifyAccessToken } from '../services/jwt'

/**
 * Middleware for user authentication.
 * Validates JWT and sets userId in context.
 */
export async function userAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: { userId: string } }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const token = authHeader.slice(7)
  const jwtSecret = c.env.JWT_SECRET || 'dev-secret-change-in-production'

  try {
    const payload = await verifyAccessToken(token, jwtSecret)
    c.set('userId', payload.sub)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}
```

## Phase 7: WebSocket Terminal Integration

### 7.1 WebSocket Handler in SessionHub

The SessionHub Durable Object handles WebSocket connections for terminal
streaming. Key functionality:

1. **CLI Connection**: When a CLI connects, it registers with the SessionHub
2. **Dashboard Connection**: When dashboard connects, it joins the session
3. **Message Relay**: Messages are relayed between CLI and dashboard
4. **Presence Tracking**: Track who is connected to each session

```typescript
// Message types for terminal WebSocket
interface TerminalMessage {
  type: 'input' | 'output' | 'resize' | 'clear' | 'connected' | 'disconnected'
  content?: string
  cols?: number
  rows?: number
  source?: 'cli' | 'dashboard'
}
```

### 7.2 Session Flow

```
1. CLI starts -> Creates session in DB -> Connects to SessionHub WebSocket
2. Dashboard loads session -> Connects to SessionHub WebSocket
3. Dashboard sends input -> SessionHub relays to CLI
4. CLI sends output -> SessionHub relays to Dashboard
5. Either side disconnects -> SessionHub notifies other side
```

## Phase 8: Data Table Components

Copy the data-table components from RedirMe.com:

1. `data-table.tsx` - Main table component
2. `data-table-header.tsx` - Search, filters, bulk actions
3. `data-table-pagination.tsx` - Pagination controls
4. `data-table-column-header.tsx` - Sortable column headers
5. `types.ts` - TypeScript definitions
6. `index.ts` - Barrel exports

These components use TanStack React Table and provide:
- Sorting (external/server-side)
- Pagination (server-side)
- Search with debounce
- Row selection with checkboxes
- Bulk actions
- Empty state handling
- Loading state

## Phase 9: Database Schema Updates

Add user authentication tables to the D1 migrations:

```sql
-- migrations/0002_user_auth.sql

-- User passwords for local auth
CREATE TABLE IF NOT EXISTS user_passwords (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- MFA tokens
CREATE TABLE IF NOT EXISTS user_mfa (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  backup_codes TEXT, -- JSON array of hashed backup codes
  enabled_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Update sessions table with additional fields
ALTER TABLE sessions ADD COLUMN device_name TEXT;
ALTER TABLE sessions ADD COLUMN device_type TEXT DEFAULT 'cli';
ALTER TABLE sessions ADD COLUMN cwd TEXT;
ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;
```

## Security Considerations

1. **Token Storage**: Store JWT in localStorage and cookie for middleware
2. **CORS**: Configure API to allow dashboard origin
3. **Token Name**: Use `nexo-user-token` (not `redirme-user-token`)
4. **Route Protection**: All `/dashboard/*` routes require valid JWT
5. **WebSocket Auth**: Pass token as query parameter for WebSocket connections

## Testing

1. **Unit Tests**: Test individual components and hooks
2. **Integration Tests**: Test API client with mock server
3. **E2E Tests**: Test full login flow and session management

## Next Steps

1. Set up the dashboard package with dependencies
2. Copy and adapt login form from RedirMe.com
3. Implement layout components (header, sidebar)
4. Build sessions overview with data table
5. Create session detail page with terminal
6. Add WebSocket terminal functionality to API
7. Test full flow from CLI to dashboard
