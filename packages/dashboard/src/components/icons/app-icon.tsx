import React from 'react'

interface AppIconProps {
  className?: string
  size?: number
}

/**
 * Nexo Application Icon Component
 *
 * The main logo/icon for the Nexo dashboard application.
 * Terminal-inspired icon matching the favicon design.
 * Colors: Tailwind violet palette - violet-900 background (#4c1d95),
 * violet-600 title bar (#7c3aed), violet-100 terminal elements (#ede9fe).
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
      {/* Terminal window background - violet-900 */}
      <rect x="2" y="3" width="20" height="18" rx="2" fill="#4c1d95" />
      {/* Title bar - violet-600 */}
      <rect x="2" y="3" width="20" height="4" rx="2" fill="#7c3aed" />
      <rect x="2" y="5" width="20" height="2" fill="#7c3aed" />
      {/* Terminal prompt arrow - violet-100 */}
      <path
        d="M6 11L10 14.5L6 18"
        stroke="#ede9fe"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor/text line - violet-100 */}
      <path
        d="M13 18H18"
        stroke="#ede9fe"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
