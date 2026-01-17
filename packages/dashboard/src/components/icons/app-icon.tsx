import React from 'react'

interface AppIconProps {
  className?: string
  size?: number
}

/**
 * klaas Application Icon Component
 *
 * Terminal-inspired icon matching the klaas.sh design.
 * Colors: Amber theme
 * - Background: #92400e (amber-900)
 * - Title bar: #f59e0b (amber-500)
 * - Terminal elements: #fef3c7 (amber-100)
 */
export function AppIcon({
  className = '',
  size = 40
}: AppIconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Terminal window background - amber-900 */}
      <rect x="2" y="3" width="20" height="18" rx="2" fill="#92400e" />
      {/* Title bar - amber-500 */}
      <rect x="2" y="3" width="20" height="4" rx="2" fill="#f59e0b" />
      <rect x="2" y="5" width="20" height="2" fill="#f59e0b" />
      {/* Terminal prompt arrow - amber-100 */}
      <path
        d="M6 11L10 14.5L6 18"
        stroke="#fef3c7"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor/text line - amber-100 */}
      <path
        d="M13 18H18"
        stroke="#fef3c7"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
