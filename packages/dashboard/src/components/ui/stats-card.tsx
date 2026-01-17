import type { ComponentType, JSX } from 'react'
import { clsx } from 'clsx'
import { TrendingUp } from 'lucide-react'

/**
 * Color variants for the stats card icon
 */
export type StatsCardColor =
  | 'amber'
  | 'green'
  | 'yellow'
  | 'red'
  | 'cyan'
  | 'purple'

/**
 * Format number with European style (dot as thousands separator)
 */
function defaultFormatValue(value: number): string {
  return value.toLocaleString('de-DE')
}

export interface StatsCardProps {
  /** Label displayed above the value */
  label: string
  /** Main value to display */
  value: number
  /** Optional change value for the period */
  change?: number
  /** Label for the change period (e.g., "last 7 days") */
  changeLabel?: string
  /** Icon component to display */
  icon: ComponentType<{ className?: string }>
  /** Color variant for the icon */
  color?: StatsCardColor
  /** Format function for numbers (defaults to European locale string) */
  formatValue?: (value: number) => string
}

/**
 * StatsCard - Statistics card matching klaas.sh styling exactly.
 * Card: rounded-xl (12px), bg-[#121216]/50, border border-white/5, p-6 (24px)
 * Icon: w-12 h-12 (48px), rounded-xl (12px), bg-[#f59e0b]/15, border-[#f59e0b]/30
 * SVG: h-6 w-6 (24px)
 */
export function StatsCard({
  label,
  value,
  change,
  changeLabel,
  icon: Icon,
  color = 'amber',
  formatValue = defaultFormatValue,
}: StatsCardProps): JSX.Element {
  const hasChangeInfo = change !== undefined && changeLabel

  // Icon colors based on variant
  const iconColorClass = {
    amber: 'text-[#f59e0b]',
    green: 'text-[#22c55e]',
    yellow: 'text-[#eab308]',
    red: 'text-[#ef4444]',
    cyan: 'text-[#22d3ee]',
    purple: 'text-[#a78bfa]',
  }[color]

  return (
    <div className="rounded-xl bg-[#121216]/50 border border-white/5 p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-[#a1a1aa]">
            {label}
          </div>
          <div className="text-2xl font-bold text-[#fafafa]">
            {formatValue(value)}
          </div>
          {/* Always reserve space for change line to keep icons aligned */}
          <div className="text-xs mt-1 flex items-center gap-1 min-h-[1rem]">
            {hasChangeInfo ? (
              change > 0 ? (
                <>
                  <TrendingUp className="h-3 w-3 text-[#f59e0b]" />
                  <span className="text-[#f59e0b]">
                    +{formatValue(change)} {changeLabel}
                  </span>
                </>
              ) : (
                <span className="text-[#52525b]">
                  No change {changeLabel}
                </span>
              )
            ) : (
              // Empty space to maintain consistent height
              <span>&nbsp;</span>
            )}
          </div>
        </div>
        {/* Icon - exact klaas.sh: 48x48px, 12px radius, accent background/border */}
        <div
          className={clsx(
            'flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center',
            'bg-[#f59e0b]/15 border border-[#f59e0b]/30'
          )}
        >
          <Icon className={clsx('h-6 w-6', iconColorClass)} />
        </div>
      </div>
    </div>
  )
}
