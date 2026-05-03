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
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86400 * 7,
      path: '/',
    })
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
      const { status, city, paid, date_from, date_to, q, pickup_point, sort, dir } = req.query
      const conditions = []
      const params = []

      if (status && status !== 'all') { conditions.push('o.status = ?'); params.push(status) }
      if (city) { conditions.push("o.customer_city LIKE ?"); params.push(`%${city}%`) }
      if (paid === '1') { conditions.push('o.is_paid = 1') }
      else if (paid === '0') { conditions.push('o.is_paid = 0') }
      if (date_from) { conditions.push('date(o.created_at) >= ?'); params.push(date_from) }
      if (date_to) { conditions.push('date(o.created_at) <= ?'); params.push(date_to) }
      if (q) { conditions.push('(o.order_number LIKE ? OR o.customer_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
      if (pickup_point) { conditions.push('o.pickup_point_name = ?'); params.push(pickup_point) }

      const SORT_COLS = {
        order_number: 'o.order_number', created_at: 'o.created_at',
        customer_name: 'o.customer_name', pickup_point_name: 'o.pickup_point_name',
        _item_count: '_item_count', _total: '_total',
        status: 'o.status', is_paid: 'o.is_paid',
      }
      const sortCol = SORT_COLS[sort] || 'o.created_at'
      const sortDir = dir === 'asc' ? 'ASC' : 'DESC'
      const orderBy = `${sortCol} ${sortDir}`

      const orders = queries.filteredOrders(conditions.join(' AND '), params, orderBy)
      const cities = queries.orderCities.all().map(r => r.customer_city)
      const pickup_points = queries.orderPickupPoints.all().map(r => r.pickup_point_name)

      return render(reply, 'admin/orders.html', req, {
        active: 'orders', orders, cities, pickup_points,
        filter_status: status || 'all', filter_city: city || '',
        filter_paid: paid || '', filter_q: q || '',
        filter_date_from: date_from || '', filter_date_to: date_to || '',
        filter_pickup: pickup_point || '',
        sort: sort || 'created_at', dir: sortDir.toLowerCase(),
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

    // Bestätigen → automatisch sperren (Kunde kann nicht mehr ändern)
    fastify.post('/bestellungen/:id/bestaetigt', orderAction((id) =>
      queries.updateOrderLocked.run({ id, is_locked: 1, status: 'confirmed' })))

    // Bestätigung zurücknehmen → entsperren (Kunde kann wieder ändern)
    fastify.post('/bestellungen/:id/nichtbestaetigt', orderAction((id) =>
      queries.updateOrderLocked.run({ id, is_locked: 0, status: 'pending' })))

    fastify.post('/bestellungen/:id/bezahlt', orderAction((id) =>
      queries.updateOrderPaid.run(id)))

    fastify.post('/bestellungen/:id/stornieren', orderAction((id) =>
      queries.updateOrderStatus.run({ id, status: 'cancelled' })))

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
      const cats = queries.allCategories.all()
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
      const cats = queries.allCategories.all()
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

    // ── Categories ─────────────────────────────────────────────────────────────
    fastify.get('/kategorien', async (req, reply) => {
      const error = req.query.error || null
      return render(reply, 'admin/categories.html', req, {
        active: 'categories',
        categories: queries.allCategories.all(),
        error,
      })
    })

    fastify.get('/kategorien/neu', async (req, reply) => {
      return render(reply, 'admin/category_form.html', req, { active: 'categories', category: null, error: null })
    })

    fastify.post('/kategorien/neu', async (req, reply) => {
      const { slug, name_de, name_tr, name_en, sort_order } = req.body
      if (!slug || !name_de) {
        return render(reply, 'admin/category_form.html', req, {
          active: 'categories', category: req.body, error: 'Slug und Deutscher Name sind Pflichtfelder.',
        })
      }
      const { name_ar } = req.body
      queries.insertCategory.run({ slug, name_de, name_tr: name_tr || '', name_en: name_en || '', name_ar: name_ar || '', sort_order: parseInt(sort_order) || 0 })
      return reply.redirect('/admin/kategorien')
    })

    fastify.get('/kategorien/:id/edit', async (req, reply) => {
      const cat = queries.categoryById.get(parseInt(req.params.id))
      if (!cat) return reply.status(404).send('Nicht gefunden')
      return render(reply, 'admin/category_form.html', req, { active: 'categories', category: cat, error: null })
    })

    fastify.post('/kategorien/:id/edit', async (req, reply) => {
      const id = parseInt(req.params.id)
      const { name_de, name_tr, name_en, name_ar, sort_order } = req.body
      queries.updateCategory.run({ id, name_de, name_tr: name_tr || '', name_en: name_en || '', name_ar: name_ar || '', sort_order: parseInt(sort_order) || 0 })
      return reply.redirect('/admin/kategorien')
    })

    fastify.post('/kategorien/:id/loeschen', async (req, reply) => {
      const id = parseInt(req.params.id)
      const { c } = queries.categoryProductCount.get(id)
      if (c > 0) return reply.redirect('/admin/kategorien?error=in_use')
      queries.deleteCategory.run(id)
      return reply.redirect('/admin/kategorien')
    })

    // ── Pickup Points ──────────────────────────────────────────────────────────
    fastify.get('/abholpunkte', async (req, reply) => {
      return render(reply, 'admin/pickup_points.html', req, {
        active: 'pickup_points',
        points: queries.allPickupPoints.all(),
      })
    })

    fastify.get('/abholpunkte/neu', async (req, reply) => {
      return render(reply, 'admin/pickup_point_form.html', req, {
        active: 'pickup_points', point: null, error: null,
      })
    })

    fastify.post('/abholpunkte/neu', async (req, reply) => {
      const { name, address, lat, lng, sort_order, is_active } = req.body
      if (!name || !address || !lat || !lng) {
        return render(reply, 'admin/pickup_point_form.html', req, {
          active: 'pickup_points', point: req.body, error: 'Name, Adresse, Lat und Lng sind Pflichtfelder.',
        })
      }
      queries.insertPickupPoint.run({
        name, address,
        lat: parseFloat(lat), lng: parseFloat(lng),
        is_active: is_active === 'true' ? 1 : 0,
        sort_order: parseInt(sort_order) || 0,
      })
      return reply.redirect('/admin/abholpunkte')
    })

    fastify.get('/abholpunkte/:id/edit', async (req, reply) => {
      const point = queries.pickupPointById.get(parseInt(req.params.id))
      if (!point) return reply.status(404).send('Nicht gefunden')
      return render(reply, 'admin/pickup_point_form.html', req, { active: 'pickup_points', point, error: null })
    })

    fastify.post('/abholpunkte/:id/edit', async (req, reply) => {
      const id = parseInt(req.params.id)
      const { name, address, lat, lng, sort_order, is_active } = req.body
      queries.updatePickupPoint.run({
        id, name, address,
        lat: parseFloat(lat), lng: parseFloat(lng),
        is_active: is_active === 'true' ? 1 : 0,
        sort_order: parseInt(sort_order) || 0,
      })
      return reply.redirect('/admin/abholpunkte')
    })

    fastify.post('/abholpunkte/:id/loeschen', async (req, reply) => {
      queries.deletePickupPoint.run(parseInt(req.params.id))
      return reply.redirect('/admin/abholpunkte')
    })

    // ── Reports ────────────────────────────────────────────────────────────────
    fastify.get('/berichte', async (req, reply) => {
      const byStatus    = queries.reportOrdersByStatus.all()
      const byMonth     = queries.reportRevenueByMonth.all()
      const topProducts = queries.reportTopProducts.all()
      const byPickup    = queries.reportByPickupPoint.all()
      const totalOrders = byStatus.reduce((s, r) => s + r.count, 0)
      const totalRevenue = byMonth.reduce((s, r) => s + r.revenue, 0)
      return render(reply, 'admin/reports.html', req, {
        active: 'reports', byStatus, byMonth, topProducts, byPickup,
        totalOrders, totalRevenue,
      })
    })

    fastify.get('/berichte/export.csv', async (req, reply) => {
      const rows = queries.reportAllOrdersCSV.all()
      const header = 'Bestellnummer,Datum,Name,E-Mail,Telefon,Stadt,PLZ,Status,Bezahlt,Abholpunkt,Gesamt (€)'
      const csv = [header, ...rows.map(r =>
        [r.order_number, r.created_at, r.customer_name, r.customer_email,
         r.customer_phone, r.customer_city, r.customer_zip, r.status,
         r.bezahlt, r.abholpunkt, r.gesamt.toFixed(2)]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
      )].join('\r\n')
      const date = new Date().toISOString().slice(0, 10)
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="haksut34-bestellungen-${date}.csv"`)
      return reply.send('﻿' + csv) // BOM für Excel
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
      name_ar: fields.name_ar || '',
      description_de: fields.description_de || '',
      description_tr: fields.description_tr || '',
      description_en: fields.description_en || '',
      description_ar: fields.description_ar || '',
      price: parseFloat(fields.price) || 0,
      unit: fields.unit || '',
      category: fields.category || 'Sonstiges',
      is_active: fields.is_active === 'true' ? 1 : 0,
      stock: fields.stock !== '' && fields.stock != null ? parseInt(fields.stock) : null,
    },
  }
}
