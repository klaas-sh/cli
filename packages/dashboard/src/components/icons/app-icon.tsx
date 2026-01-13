import React from 'react'

interface AppIconProps {
  className?: string
  size?: number
}

/**
 * Nexo Application Icon Component
 *
 * The main logo/icon for the Nexo dashboard application.
 * Terminal-inspired icon representing remote CLI sessions.
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
      {/* Terminal window outline */}
      <rect
        x="2"
        y="3"
        width="20"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Title bar line */}
      <path
        d="M2 7H22"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Terminal prompt arrow */}
      <path
        d="M6 12L10 15L6 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor/text line */}
      <path
        d="M13 18H18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
