import { writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { db, queries } from '../db.js'
import { makeSessionToken, verifySessionToken, hashPassword, verifyPassword } from '../auth.js'

const __dirname = join(fileURLToPath(import.meta.url), '..', '..', '..')
const PRODUCTS_IMG_DIR = join(__dirname, 'static', 'img', 'products')
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const SESSION_COOKIE = 'admin_session'

export default async function adminRoutes(fastify) {
  const { render } = fastify

  // ── Auth helper ─────────────────────────────────────────────────────────────
  async function requireAdmin(req, reply) {
    const token = req.cookies[SESSION_COOKIE]
    const username = verifySessionToken(token)
    if (!username || !queries.adminByUsername.get(username)) {
      return reply.redirect('/admin/login')
    }
    req.adminUser = username
  }

  // ── Login ────────────────────────────────────────────────────────────────────
  fastify.get('/login', async (req, reply) => {
    return render(reply, 'admin/login.html', req, { error: null })
  })

  fastify.post('/login', async (req, reply) => {
    const { username, password } = req.body
    const user = queries.adminByUsername.get(username)
    if (!user || !verifyPassword(password, user.hashed_password)) {
      return render(reply, 'admin/login.html', req, { error: 'Ungültige Zugangsdaten' })
    }
    const token = makeSessionToken(user.username)
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 86400 * 7, path: '/' })
    return reply.redirect('/admin/')
  })

  fastify.get('/logout', async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.redirect('/admin/login')
  })

  // ── Protected routes ─────────────────────────────────────────────────────────
  fastify.register(async function protected_(fastify) {
    fastify.addHook('preHandler', requireAdmin)

    // Dashboard
    fastify.get('/', async (req, reply) => {
      return render(reply, 'admin/dashboard.html', req, {
        active: 'dashboard',
        orders_today: queries.ordersToday.get().c,
        open_orders: queries.openOrders.get().c,
        unpaid: queries.unpaidOrders.get().c,
        revenue_all: queries.revenueAll.get().v,
        revenue_month: queries.revenueMonth.get().v,
        recent_orders: queries.recentOrders.all(),
      })
    })

    // ── Orders ─────────────────────────────────────────────────────────────────
    fastify.get('/bestellungen', async (req, reply) => {
      const { status, city, paid, date_from, date_to, q } = req.query
      const conditions = []
      const params = []

      if (status && status !== 'all') { conditions.push('o.status = ?'); params.push(status) }
      if (city) { conditions.push("o.customer_city LIKE ?"); params.push(`%${city}%`) }
      if (paid === '1') { conditions.push('o.is_paid = 1') }
      else if (paid === '0') { conditions.push('o.is_paid = 0') }
      if (date_from) { conditions.push('date(o.created_at) >= ?'); params.push(date_from) }
      if (date_to) { conditions.push('date(o.created_at) <= ?'); params.push(date_to) }
      if (q) { conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }

      const orders = queries.filteredOrders(conditions.join(' AND '), params)
      const cities = queries.orderCities.all().map(r => r.customer_city)

      return render(reply, 'admin/orders.html', req, {
        active: 'orders', orders, cities,
        filter_status: status || 'all', filter_city: city || '',
        filter_paid: paid || '', filter_q: q || '',
        filter_date_from: date_from || '', filter_date_to: date_to || '',
      })
    })

    fastify.get('/bestellungen/:id', async (req, reply) => {
      const order = queries.orderById(parseInt(req.params.id))
      if (!order) return reply.status(404).send('Nicht gefunden')
      const total = order.items.reduce((s, i) => s + i.subtotal, 0)
      return render(reply, 'admin/order_detail.html', req, { active: 'orders', order, total })
    })

    const orderAction = (handler) => async (req, reply) => {
      const id = parseInt(req.params.id)
      handler(id)
      return reply.redirect(`/admin/bestellungen/${id}`)
    }

    fastify.post('/bestellungen/:id/sperren', orderAction((id) =>
      queries.updateOrderLocked.run({ id, is_locked: 1, status: 'locked' })))

    fastify.post('/bestellungen/:id/bezahlt', orderAction((id) =>
      queries.updateOrderPaid.run(id)))

    fastify.post('/bestellungen/:id/bestaetigt', orderAction((id) =>
      queries.updateOrderStatus.run({ id, status: 'confirmed' })))

    fastify.post('/bestellungen/:id/geliefert', orderAction((id) =>
      queries.updateOrderLocked.run({ id, is_locked: 1, status: 'delivered' })))

    fastify.post('/bestellungen/:id/stornieren', orderAction((id) =>
      queries.updateOrderStatus.run({ id, status: 'cancelled' })))

    fastify.post('/bestellungen/:id/nichtgeliefert', orderAction((id) =>
      queries.updateOrderLocked.run({ id, is_locked: 0, status: 'confirmed' })))

    fastify.post('/bestellungen/:id/nichtbestaetigt', orderAction((id) =>
      queries.updateOrderStatus.run({ id, status: 'pending' })))

    fastify.post('/bestellungen/:id/nichtbezahlt', orderAction((id) =>
      queries.updateOrderUnpaid.run(id)))

    // ── Products ───────────────────────────────────────────────────────────────
    fastify.get('/produkte', async (req, reply) => {
      return render(reply, 'admin/products.html', req, {
        active: 'products',
        products: queries.allProducts.all(),
      })
    })

    fastify.get('/produkte/neu', async (req, reply) => {
      const cats = queries.categories.all().map(r => r.category)
      return render(reply, 'admin/product_form.html', req, { active: 'products', product: null, categories: cats, error: null })
    })

    fastify.post('/produkte/neu', { config: { multipart: true } }, async (req, reply) => {
      const { fields, imageUrl } = await parseProductForm(req)
      queries.insertProduct.run({ ...fields, image_url: imageUrl, is_active: fields.is_active, stock: fields.stock })
      return reply.redirect('/admin/produkte')
    })

    fastify.get('/produkte/:id/edit', async (req, reply) => {
      const product = queries.productById.get(parseInt(req.params.id))
      if (!product) return reply.status(404).send('Nicht gefunden')
      const cats = queries.categories.all().map(r => r.category)
      return render(reply, 'admin/product_form.html', req, { active: 'products', product, categories: cats, error: null })
    })

    fastify.post('/produkte/:id/edit', { config: { multipart: true } }, async (req, reply) => {
      const id = parseInt(req.params.id)
      const product = queries.productById.get(id)
      if (!product) return reply.status(404).send('Nicht gefunden')
      const { fields, imageUrl } = await parseProductForm(req)
      queries.updateProduct.run({ ...fields, id, image_url: imageUrl || product.image_url })
      return reply.redirect('/admin/produkte')
    })

    fastify.post('/produkte/:id/toggle', async (req, reply) => {
      queries.toggleProduct.run(parseInt(req.params.id))
      return reply.redirect('/admin/produkte')
    })

    fastify.post('/produkte/:id/loeschen', async (req, reply) => {
      queries.deleteProduct.run(parseInt(req.params.id))
      return reply.redirect('/admin/produkte')
    })
  })
}

// ── Multipart form helper ─────────────────────────────────────────────────────
async function parseProductForm(req) {
  const fields = {}
  let imageUrl = ''

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (!part.filename || !part.filename.trim()) { await part.resume(); continue }
      const ext = extname(part.filename).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) { await part.resume(); continue }
      const buf = await part.toBuffer()
      if (buf.length > 5 * 1024 * 1024) continue // silently skip oversized
      mkdirSync(PRODUCTS_IMG_DIR, { recursive: true })
      const filename = `${randomBytes(16).toString('hex')}${ext}`
      writeFileSync(join(PRODUCTS_IMG_DIR, filename), buf)
      imageUrl = `/static/img/products/${filename}`
    } else {
      fields[part.fieldname] = part.value
    }
  }

  return {
    imageUrl: imageUrl || fields.image_url || '',
    fields: {
      name_de: fields.name_de || '',
      name_tr: fields.name_tr || '',
      name_en: fields.name_en || '',
      description_de: fields.description_de || '',
      description_tr: fields.description_tr || '',
      description_en: fields.description_en || '',
      price: parseFloat(fields.price) || 0,
      unit: fields.unit || '',
      category: fields.category || 'Sonstiges',
      is_active: fields.is_active === 'true' ? 1 : 0,
      stock: fields.stock !== '' && fields.stock != null ? parseInt(fields.stock) : null,
    },
  }
}
