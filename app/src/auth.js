import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

// Fallback: zufälliger Schlüssel pro Start (sicher, aber Sessions enden bei Neustart).
// In Produktion immer SECRET_KEY als Umgebungsvariable setzen.
const SECRET = process.env.SECRET_KEY || (() => {
  console.warn('⚠️  SECRET_KEY nicht gesetzt – temporärer Zufallsschlüssel aktiv. Sessions enden bei Neustart.')
  return randomBytes(32).toString('hex')
})()

export function makeSessionToken(username) {
  const ts = String(Date.now())
  const sig = createHmac('sha256', SECRET).update(`${username}:${ts}`).digest('hex')
  return `${username}:${ts}:${sig}`
}

export function verifySessionToken(token) {
  if (!token) return null
  try {
    const parts = token.split(':')
    if (parts.length !== 3) return null
    const [username, ts, sig] = parts
    const expected = createHmac('sha256', SECRET).update(`${username}:${ts}`).digest('hex')
    if (timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return username
  } catch {}
  return null
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10)
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash)
