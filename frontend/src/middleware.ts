import { NextRequest, NextResponse } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

// Wrap the next-intl middleware so that requests to "/" are redirected to
// the default-locale-prefixed path (e.g. "/zh-CN"). With
// `localePrefix: 'always'`, next-intl does not do this redirect itself, so
// visiting the root URL would 404.
export default function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/') {
    const url = req.nextUrl.clone()
    url.pathname = `/${routing.defaultLocale}`
    return NextResponse.redirect(url)
  }
  return intlMiddleware(req)
}

export const config = {
  // Match all pathnames except for
  // - api, _next, _vercel, monitor.* (Vercel), and static files
  matcher: ['/((?!api|_next|_vercel|monitor.*|.*\\..*).*)']
}