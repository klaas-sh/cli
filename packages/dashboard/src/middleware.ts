import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Token keys for authentication
 */
const TOKEN_KEY = 'user-token'
const REFRESH_TOKEN_KEY = 'user-refresh-token'

/**
 * Set token cookies on a response
 */
function setTokenCookies(
  response: NextResponse,
  tokens: { access_token: string; refresh_token: string }
): void {
  // Access token - 1 day expiry
  response.cookies.set(TOKEN_KEY, tokens.access_token, {
    path: '/',
    maxAge: 60 * 60 * 24,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  })

  // Refresh token - 30 days expiry
  response.cookies.set(REFRESH_TOKEN_KEY, tokens.refresh_token, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  })
}

/**
 * Clear token cookies on a response
 */
function clearTokenCookies(response: NextResponse): void {
  response.cookies.delete(TOKEN_KEY)
  response.cookies.delete(REFRESH_TOKEN_KEY)
}

/**
 * Add security headers to response
 */
function addSecurityHeaders(response: NextResponse, apiUrl: string): void {
  const apiHost = new URL(apiUrl).origin

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; connect-src 'self' ${apiHost} ` +
    `http://localhost:* ws://localhost:*; ` +
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'; ` +
    `style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; ` +
    `font-src 'self' data:;`
  )
}

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
    // In development with dynamic ports, use the detected API port
    const apiUrl = process.env.NEXT_PUBLIC_DEV_API_PORT
      ? `http://localhost:${process.env.NEXT_PUBLIC_DEV_API_PORT}`
      : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787')

    let currentToken = token
    let authCheckResponse: Response | null = null

    try {
      authCheckResponse = await fetch(
        `${apiUrl}/dashboard/auth/check`,
        {
          headers: {
            'Authorization': `Bearer ${currentToken}`
          }
        }
      )

      // If token expired (401), try to refresh
      if (authCheckResponse.status === 401) {
        const refreshToken = request.cookies.get(REFRESH_TOKEN_KEY)?.value
        if (refreshToken) {
          const refreshResponse = await fetch(
            `${apiUrl}/auth/refresh`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken })
            }
          )

          if (refreshResponse.ok) {
            const tokens = await refreshResponse.json() as {
              access_token: string
              refresh_token: string
            }
            currentToken = tokens.access_token

            // Retry auth check with new token
            authCheckResponse = await fetch(
              `${apiUrl}/dashboard/auth/check`,
              {
                headers: {
                  'Authorization': `Bearer ${currentToken}`
                }
              }
            )

            // If successful, we need to update cookies in the response
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
                const redirectResponse = NextResponse.redirect(
                  new URL('/change-password', request.url)
                )
                setTokenCookies(redirectResponse, tokens)
                return redirectResponse
              }

              if (authResult.data?.requiresMFASetup) {
                const redirectResponse = NextResponse.redirect(
                  new URL('/setup-mfa', request.url)
                )
                setTokenCookies(redirectResponse, tokens)
                return redirectResponse
              }

              // Continue with updated cookies
              const response = NextResponse.next()
              setTokenCookies(response, tokens)
              addSecurityHeaders(response, apiUrl)
              return response
            }
          }
        }

        // Refresh failed or no refresh token - redirect to login
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('returnUrl', pathname)
        const redirectResponse = NextResponse.redirect(loginUrl)
        // Clear invalid tokens
        clearTokenCookies(redirectResponse)
        return redirectResponse
      }

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
      // If auth check fails due to network error, continue and let page handle it
    }
  }

  // Add security headers
  const response = NextResponse.next()

  // Get API URL from environment or use default
  // In development with dynamic ports, use the detected API port
  const defaultApiUrl = process.env.NEXT_PUBLIC_DEV_API_PORT
    ? `http://localhost:${process.env.NEXT_PUBLIC_DEV_API_PORT}`
    : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787')

  addSecurityHeaders(response, defaultApiUrl)

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
    '/((?!api/health|_next/static|_next/image|favicon\\.ico|favicon-.*\\.png|apple-touch-icon\\.png|site\\.webmanifest|robots\\.txt|favicon\\.svg|android-chrome-.*\\.png|public).*)'
  ],
}
