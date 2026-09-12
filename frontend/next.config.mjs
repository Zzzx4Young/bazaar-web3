import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:3001'
    return [{ source: '/api/:path*', destination: `${backendOrigin}/api/:path*` }]
  },
  images: {
    // Dev mode: skip Next.js image optimizer so the browser fetches the
    // origin URL directly. The dev optimizer (Node fetch) hits TLS
    // negotiation issues on some networks; this avoids 500s during local
    // development. Production builds still use the optimizer (default).
    unoptimized: process.env.NODE_ENV === 'development',
    remotePatterns: [
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'picsum.photos' },
      { protocol: 'https', hostname: 'api.dicebear.com' }
    ]
  }
}

export default withNextIntl(nextConfig)
