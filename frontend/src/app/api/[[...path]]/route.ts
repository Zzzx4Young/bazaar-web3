import { proxyApiRequest } from '@/lib/api-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function proxy(request: Request) {
  return proxyApiRequest(request, process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:3001')
}

export {
  proxy as GET,
  proxy as HEAD,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS
}
