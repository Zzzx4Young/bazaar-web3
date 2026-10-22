import { createHash, createPublicKey, verify } from 'node:crypto'
import { type AppConfig } from '../config.js'
import { DomainError } from '../common/domain-error.js'
import { normalizeGmail } from './email-code.js'

export interface GoogleProfile { sub: string; email: string; name: string }
export interface GoogleClient {
  authorizeUrl(input: { state: string; nonce: string; verifier: string }): string
  exchange(input: { code: string; verifier: string; nonce: string }): Promise<GoogleProfile>
}

const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export class GoogleOidcClient implements GoogleClient {
  private keys: { keys: Array<{ kid?: string; kty?: string; alg?: string }> } | null = null
  private keysExpireAt = 0

  constructor(private readonly config: NonNullable<AppConfig['googleOAuth']>) {}

  authorizeUrl({ state, nonce, verifier }: { state: string; nonce: string; verifier: string }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state, nonce,
      code_challenge: challenge(verifier),
      code_challenge_method: 'S256'
    }).toString()
    return url.toString()
  }

  private async jwk(kid: string) {
    if (!this.keys || Date.now() >= this.keysExpireAt || !this.keys.keys.some(key => key.kid === kid)) {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new DomainError('GOOGLE_UNAVAILABLE')
      const body = await response.json() as typeof this.keys
      if (!body || !Array.isArray(body.keys)) throw new DomainError('GOOGLE_UNAVAILABLE')
      this.keys = body
      this.keysExpireAt = Date.now() + 300_000
    }
    const key = this.keys.keys.find(value => value.kid === kid && value.kty === 'RSA')
    if (!key) throw new DomainError('GOOGLE_INVALID')
    return key
  }

  private async profile(idToken: string, nonce: string): Promise<GoogleProfile> {
    const parts = idToken.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new DomainError('GOOGLE_INVALID')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string }
    if (header.alg !== 'RS256' || !header.kid) throw new DomainError('GOOGLE_INVALID')
    const key = await this.jwk(header.kid)
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')))
      throw new DomainError('GOOGLE_INVALID')
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    if (
      !['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss)) ||
      claims.aud !== this.config.clientId ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      typeof claims.iat !== 'number' || claims.iat > now + 60 ||
      claims.nonce !== nonce || claims.email_verified !== true ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 100 ||
      typeof claims.email !== 'string'
    ) throw new DomainError('GOOGLE_INVALID')
    let email: string
    try { email = normalizeGmail(claims.email) }
    catch { throw new DomainError('GOOGLE_INVALID') }
    return { sub: claims.sub, email,
      name: typeof claims.name === 'string' ? claims.name.slice(0, 100) : email.split('@')[0] }
  }

  async exchange({ code, verifier, nonce }: { code: string; verifier: string; nonce: string }) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, code_verifier: verifier,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code'
      })
    })
    if (!response.ok) throw new DomainError('GOOGLE_INVALID')
    const body = await response.json() as { id_token?: string }
    if (typeof body.id_token !== 'string') throw new DomainError('GOOGLE_INVALID')
    return this.profile(body.id_token, nonce)
  }
}
