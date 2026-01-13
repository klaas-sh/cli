import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Token key for authentication
 */
const TOKEN_KEY = 'nexo-user-token'

/**
 * Middleware for authentication and route protection
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = [
    '/login',
    '/api/health'
  ]

  // Onboarding routes that require authentication but bypass onboarding checks
  const onboardingRoutes = ['/change-password', '/setup-mfa']

  // Check if the current path is a public or onboarding route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isOnboardingRoute = onboardingRoutes.some(route =>
    pathname.startsWith(route)
  )

  // Get auth token from cookies or headers
  const token = request.cookies.get(TOKEN_KEY)?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')

  // If accessing a protected route without token, redirect to login
  if (!isPublicRoute && !token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('returnUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // If accessing login with valid token, redirect to home
  if (pathname === '/login' && token) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Check onboarding status for authenticated users accessing protected routes
  if (token && !isPublicRoute && !isOnboardingRoute) {
    try {
      // In development with dynamic ports, use the detected API port
      const apiUrl = process.env.NEXT_PUBLIC_DEV_API_PORT
        ? `http://localhost:${process.env.NEXT_PUBLIC_DEV_API_PORT}`
        : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787')

      const authCheckResponse = await fetch(
        `${apiUrl}/dashboard/auth/check`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (authCheckResponse.ok) {
        const authResult = await authCheckResponse.json() as {
          success: boolean
          data?: {
            requiresPasswordChange?: boolean
            requiresMFASetup?: boolean
          }
        }

        // Enforce onboarding sequence
        if (authResult.data?.requiresPasswordChange) {
          return NextResponse.redirect(
            new URL('/change-password', request.url)
          )
        }

        if (authResult.data?.requiresMFASetup) {
          return NextResponse.redirect(new URL('/setup-mfa', request.url))
        }
      }
    } catch {
      // If auth check fails, continue (token might be invalid)
      // Let the page handle the error
    }
  }

  // Add security headers
  const response = NextResponse.next()

  // Get API URL from environment or use default
  // In development with dynamic ports, use the detected API port
  const apiUrl = process.env.NEXT_PUBLIC_DEV_API_PORT
    ? `http://localhost:${process.env.NEXT_PUBLIC_DEV_API_PORT}`
    : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787')
  const apiHost = new URL(apiUrl).origin

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; connect-src 'self' ${apiHost} ` +
    `http://localhost:8787 http://localhost:* ws://localhost:*; ` +
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'; ` +
    `style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; ` +
    `font-src 'self' data:;`
  )

  return response
}

/**
 * Configure which routes should run the middleware
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/health (health check)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - Static files (favicon, manifest, robots, etc.)
     * - public files (public folder)
     */
    '/((?!api/health|_next/static|_next/image|favicon\\.ico|favicon-.*\\.png' +
    '|apple-touch-icon\\.png|site\\.webmanifest|robots\\.txt|favicon\\.svg' +
    '|android-chrome-.*\\.png|public).*)'
  ],
}
