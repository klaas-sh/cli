'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Terminal,
  ArrowRight,
  Monitor,
  Smartphone,
  Clock,
  Activity,
  Eye,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { dashboardApi } from '@/lib/dashboard-api'
import { formatRelativeTime } from '@/lib/date-utils'
import { StatsCard } from '@/components/ui/stats-card'
import { Badge } from '@/components/ui/badge'
import type { Session } from '@/types/session'

/**
 * Quick action button matching klaas.sh glow-card styling exactly.
 * Card: rounded-xl (12px), bg-[#121216]/50, p-6 (24px)
 * Icon: w-12 h-12 (48px), rounded-xl (12px)
 * SVG: h-6 w-6 (24px)
 */
function QuickActionButton({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
}): React.JSX.Element {
  return (
    <Link href={href}>
      <div
        className={clsx(
          'rounded-xl bg-[#121216]/50 border border-white/5',
          'p-6 transition-all hover:border-[#f59e0b]/30 cursor-pointer h-full'
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={clsx(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              'flex-shrink-0 bg-[#f59e0b]/15 border border-[#f59e0b]/30'
            )}
          >
            <Icon className="h-6 w-6 text-[#f59e0b]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[#fafafa] mb-1">
              {label}
            </h3>
            <p className="text-sm text-[#a1a1aa]">
              {description}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-[#71717a] flex-shrink-0 mt-1" />
        </div>
      </div>
    </Link>
  )
}

/**
 * Dashboard stats calculated from sessions
 */
interface DashboardStats {
  totalSessions: number
  activeSessions: number
  idleSessions: number
  recentSessions: Session[]
}

/**
 * User dashboard page showing Klaas stats and quick actions
 */
export default function DashboardPage(): React.JSX.Element {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData(): Promise<void> {
      setLoading(true)
      try {
        const response = await dashboardApi.getSessions({
          page: 1,
          limit: 10,
        })

        const sessions = response.data
        const activeSessions = sessions.filter(s => s.status === 'active').length
        const idleSessions = sessions.filter(s => s.status === 'idle').length

        setStats({
          totalSessions: response.meta.total,
          activeSessions,
          idleSessions,
          recentSessions: sessions.slice(0, 5),
        })
      } catch (err) {
        setError('Failed to load dashboard stats')
        // eslint-disable-next-line no-console
        console.error('Stats error:', err)
      }
      setLoading(false)
    }

    void loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4
            border-[#f59e0b] border-t-transparent"
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-500/30 p-4
        text-red-400">
        {error}
      </div>
    )
  }

  if (!stats) {
    return <div className="text-[#a1a1aa]">Loading...</div>
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#fafafa]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[#a1a1aa]">
          Welcome back! Here is your Klaas overview
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          label="Total Sessions"
          value={stats.totalSessions}
          icon={Terminal}
          color="amber"
        />
        <StatsCard
          label="Active Sessions"
          value={stats.activeSessions}
          icon={Activity}
          color="green"
        />
        <StatsCard
          label="Idle Sessions"
          value={stats.idleSessions}
          icon={Clock}
          color="yellow"
        />
      </div>

      {/* Recent Sessions - exact klaas.sh glow-card styling */}
      <div className="rounded-xl bg-[#121216]/50 border border-white/5">
        <div
          className="px-6 py-4 flex items-center justify-between"
        >
          <h3 className="text-lg font-semibold text-[#fafafa]">
            Recent Sessions
          </h3>
          <Link
            href="/sessions"
            className="text-sm text-[#f59e0b] hover:text-[#fbbf24]"
          >
            View all
          </Link>
        </div>
        <div className="divide-y divide-white/5">
          {stats.recentSessions.length === 0 ? (
            <div className="px-6 py-8 text-center text-[#a1a1aa]">
              No sessions yet. Start a terminal session using the CLI.
            </div>
          ) : (
            stats.recentSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => router.push(`/sessions/${session.id}`)}
                className={clsx(
                  'flex w-full items-center gap-4 px-6 py-4 text-left',
                  'hover:bg-[#18181c] transition-colors cursor-pointer'
                )}
              >
                <div
                  className={clsx(
                    'w-12 h-12 rounded-xl flex items-center justify-center',
                    'bg-[#f59e0b]/15 border border-[#f59e0b]/30'
                  )}
                >
                  {session.deviceType === 'cli' ? (
                    <Monitor className="h-6 w-6 text-[#f59e0b]" />
                  ) : (
                    <Smartphone className="h-6 w-6 text-[#f59e0b]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#fafafa]">
                      {session.deviceName}
                    </span>
                  </div>
                  <p
                    className="text-xs text-[#71717a] font-mono
                      truncate max-w-[300px]"
                  >
                    {session.cwd}
                  </p>
                </div>
                <Badge
                  variant={
                    session.status === 'active' ? 'success' :
                    session.status === 'idle' ? 'warning' : 'default'
                  }
                >
                  {session.status.charAt(0).toUpperCase() +
                    session.status.slice(1)}
                </Badge>
                <span className="text-xs text-[#71717a]">
                  {formatRelativeTime(session.lastActivityAt)}
                </span>
                <Eye className="h-4 w-4 text-[#52525b]" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-[#fafafa] mb-4">
          Quick Actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <QuickActionButton
            href="/sessions"
            icon={Terminal}
            label="View Sessions"
            description="Browse and manage your terminal sessions"
          />
          <QuickActionButton
            href="/settings"
            icon={Settings}
            label="Settings"
            description="Configure encryption and account preferences"
          />
        </div>
      </div>
    </div>
  )
}
