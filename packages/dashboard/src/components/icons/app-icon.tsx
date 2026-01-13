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
 * Colors: Dark blue background (#1e40af), primary blue title bar (#2563eb),
 * soft white terminal elements (#cfcfcf).
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
      {/* Terminal window background */}
      <rect x="2" y="3" width="20" height="18" rx="2" fill="#1e40af" />
      {/* Title bar */}
      <rect x="2" y="3" width="20" height="4" rx="2" fill="#2563eb" />
      <rect x="2" y="5" width="20" height="2" fill="#2563eb" />
      {/* Terminal prompt arrow */}
      <path
        d="M6 11L10 14.5L6 18"
        stroke="#cfcfcf"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor/text line */}
      <path
        d="M13 18H18"
        stroke="#cfcfcf"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
