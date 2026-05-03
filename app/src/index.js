import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { seedProducts, seedCategories, migrateArabicNames } from './db.js'
import { makeT, createNunjucksEnv } from './i18n.js'
import { hashPassword } from './auth.js'
import { queries } from './db.js'
import shopRoutes from './routes/shop.js'
import ordersRoutes from './routes/orders.js'
import adminRoutes from './routes/admin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// ── App ────────────────────────────────────────────────────────────────────────
const app = Fastify({ trustProxy: true, logger: { level: process.env.LOG_LEVEL || 'info' } })

// ── Nunjucks ───────────────────────────────────────────────────────────────────
const njk = createNunjucksEnv(path.join(ROOT, 'templates'))

// Decorate reply with render() helper – injects lang, t, path, currentYear automatically
app.decorateReply('view', null)
app.addHook('onReady', async () => {
  // noop – just ensures njk is initialised before first request
})

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || ''

// render helper exposed via fastify instance so routes can call fastify.render(reply, ...)
app.decorate('render', (reply, template, request, extra = {}) => {
  const lang = request.lang || 'tr'
  const html = njk.render(template, {
    lang,
    t: makeT(lang),
    path: new URL(request.url, 'http://localhost').pathname,
    currentYear: new Date().getFullYear(),
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    ...extra,
  })
  return reply.type('text/html').send(html)
})

// ── Plugins ────────────────────────────────────────────────────────────────────
await app.register(cookie)
await app.register(formbody)
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })
await app.register(staticFiles, {
  root: path.join(ROOT, 'static'),
  prefix: '/static/',
})

// ── i18n middleware ────────────────────────────────────────────────────────────
app.addHook('preHandler', (req, reply, done) => {
  const lang = req.cookies.lang || 'tr'
  req.lang = ['de', 'tr', 'ar'].includes(lang) ? lang : 'tr'
  done()
})

// ── Language switch ────────────────────────────────────────────────────────────
app.get('/sprache/:lang', (req, reply) => {
  const lang = ['de', 'tr', 'ar'].includes(req.params.lang) ? req.params.lang : 'tr'
  reply.setCookie('lang', lang, { maxAge: 365 * 24 * 3600, path: '/', sameSite: 'lax' })
  // Nur auf denselben Ursprung weiterleiten – verhindert Open-Redirect-Angriffe über Referer
  const referer = req.headers.referer || ''
  const origin = `${req.protocol}://${req.hostname}`
  const target = referer.startsWith(origin) ? referer : '/'
  return reply.redirect(target)
})

// ── Routes ─────────────────────────────────────────────────────────────────────
await app.register(shopRoutes)
await app.register(ordersRoutes)
await app.register(adminRoutes, { prefix: '/admin' })

// ── Start ──────────────────────────────────────────────────────────────────────
seedProducts()
seedCategories()
migrateArabicNames()
seedAdmin()

await app.listen({ port: 8000, host: '0.0.0.0' })
console.log('🚀 Haksüt34 läuft auf http://0.0.0.0:8000')

function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || ''
  if (!password) { console.warn('⚠️  ADMIN_PASSWORD nicht gesetzt'); return }
  queries.insertAdmin.run(username, hashPassword(password))
}
