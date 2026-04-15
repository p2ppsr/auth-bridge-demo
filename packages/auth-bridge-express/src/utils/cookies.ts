import type { Response } from 'express'

/**
 * Set the auth bridge session cookie.
 * Automatically sets `secure` based on NODE_ENV — only secure in production.
 */
export function setSessionCookie(res: Response, token: string, maxAgeMs: number = 3600_000): void {
  res.cookie('auth_bridge_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs
  })
}
