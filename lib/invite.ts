import { randomBytes } from 'node:crypto'

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}
