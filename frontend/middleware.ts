import createMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Match all pathnames except for
  // - api, _next, _vercel, monitor.* (Vercel), and static files
  matcher: ['/((?!api|_next|_vercel|monitor.*|.*\\..*).*)']
}