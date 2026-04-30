import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'

const SECRET = process.env.SECRET_KEY || 'changeme-set-SECRET_KEY-in-env'

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
