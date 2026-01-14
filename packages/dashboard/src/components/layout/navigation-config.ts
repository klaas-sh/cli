import { Terminal, Settings } from 'lucide-react'

/**
 * Navigation item type for sidebar navigation
 */
export interface NavigationItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  badge?: string | number
}

/**
 * Navigation items for the Klaas dashboard sidebar
 *
 * Minimal navigation with Sessions as the primary feature.
 */
export const navigationItems: NavigationItem[] = [
  {
    name: 'Sessions',
    href: '/',
    icon: Terminal,
    description: 'Active Claude Code sessions',
  },
]

/**
 * Settings navigation item
 *
 * Separated from main navigation as it appears in the footer.
 */
export const settingsItem: NavigationItem = {
  name: 'Settings',
  href: '/settings',
  icon: Settings,
  description: 'Account settings',
}
