import React from 'react'
import Link from 'next/link'

/**
 * 404 Not Found page.
 * Server Component that renders the 404 error page.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50
      dark:bg-gray-900">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 dark:text-white mb-4">
          404
        </h1>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-300
          mb-4">
          Page Not Found
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 bg-violet-600
            text-white font-medium rounded-lg hover:bg-violet-700
            transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  )
}
