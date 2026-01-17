import { LayoutDashboard, Terminal, Settings, HelpCircle } from 'lucide-react'

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
 * Dashboard home, sessions management, and navigation items.
 */
export const navigationItems: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    description: 'Overview and statistics',
  },
  {
    name: 'Sessions',
    href: '/sessions',
    icon: Terminal,
    description: 'Active terminal sessions',
  },
]

/**
 * Footer navigation items
 *
 * Support and settings appear in the footer.
 */
export const footerNavigationItems: NavigationItem[] = [
  {
    name: 'Support',
    href: '/support',
    icon: HelpCircle,
    description: 'Get help and support',
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    description: 'Account settings',
  },
]

/**
 * Settings navigation item (for backwards compatibility)
 *
 * @deprecated Use footerNavigationItems instead
 */
export const settingsItem: NavigationItem = {
  name: 'Settings',
  href: '/settings',
  icon: Settings,
  description: 'Account settings',
}
