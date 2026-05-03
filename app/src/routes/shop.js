import { randomBytes } from 'node:crypto'
import { db, queries, seedProducts } from '../db.js'
import { sendOrderConfirmation, sendNewOrderAdmin } from '../email.js'

// ── Rate limiter ──────────────────────────────────────────────────────────────
const _rateStore = new Map()
function checkRateLimit(ip) {
  const now = Date.now()
  const window = 3_600_000
  const times = (_rateStore.get(ip) || []).filter(t => now - t < window)
  if (times.length >= 5) return false
  _rateStore.set(ip, [...times, now])
  return true
}

// ── Order number / token ──────────────────────────────────────────────────────
function generateOrderNumber() {
  const year = new Date().getFullYear()
  const suffix = randomBytes(3).toString('hex').toUpperCase()
  return `HS34-${year}-${suffix}`
}
function generateEditToken() {
  return randomBytes(16).toString('hex') + '-' + randomBytes(4).toString('hex')
}

export default async function shopRoutes(fastify) {
  const { render } = fastify

  // GET /
  fastify.get('/', async (req, reply) => {
    const products = queries.allActiveProducts.all()
    const allCats = queries.allCategories.all()
    const lang = req.lang
    const categoryNames = {}
    for (const c of allCats) categoryNames[c.slug] = c[`name_${lang}`] || c.name_de || c.slug
    const productSlugs = new Set(products.map(p => p.category))
    const categories = allCats.filter(c => productSlugs.has(c.slug)).map(c => c.slug)
    for (const slug of productSlugs) if (!categories.includes(slug)) categories.push(slug)
    return render(reply, 'shop/index.html', req, { products, categories, categoryNames })
  })

  // GET /warenkorb
  fastify.get('/warenkorb', async (req, reply) => {
    const pickupPoints = queries.allActivePickupPoints.all()
    return render(reply, 'shop/cart.html', req, { pickupPoints })
  })

  // POST /bestellung/aufgeben
  fastify.post('/bestellung/aufgeben', async (req, reply) => {
    const ip = req.ip
    if (!checkRateLimit(ip)) {
      reply.status(429)
      return render(reply, 'shop/cart.html', req, { error: 'Zu viele Bestellungen. Bitte warte eine Stunde.' })
    }

    const body = req.body
    let items
    try { items = JSON.parse(body.items_json || '[]') } catch { items = [] }
    if (!items.length) {
      reply.status(400)
      return render(reply, 'shop/cart.html', req, { error: 'Warenkorb ist leer.' })
    }

    const orderNumber = generateOrderNumber()
    const editToken = generateEditToken()

    const pickupPointId = parseInt(body.pickup_point_id) || null
    let pickupPointName = body.pickup_point_name || null
    if (pickupPointId && !pickupPointName) {
      const pp = queries.pickupPointById.get(pickupPointId)
      if (pp) pickupPointName = pp.name
    }

    const place = db.transaction(() => {
      const info = queries.insertOrder.run({
        order_number: orderNumber,
        edit_token: editToken,
        customer_name: body.customer_name,
        customer_email: body.customer_email.trim().toLowerCase(),
        customer_phone: body.customer_phone,
        customer_address: body.customer_address,
        customer_city: body.customer_city,
        customer_zip: body.customer_zip,
        customer_country: body.customer_country || 'Deutschland',
        customer_note: body.customer_note || null,
        language: body.language || 'tr',
        pickup_point_id: pickupPointId,
        pickup_point_name: pickupPointName,
      })
      const orderId = info.lastInsertRowid

      for (const item of items) {
        const product = queries.productById.get(item.product_id)
        if (!product || !product.is_active) continue
        const qty = Math.max(1, parseInt(item.quantity) || 1)
        queries.insertOrderItem.run({
          order_id: orderId,
          product_id: product.id,
          product_name: item.name || product.name_de,
          product_price: product.price,
          quantity: qty,
          subtotal: Math.round(product.price * qty * 100) / 100,
        })
      }
      return orderId
    })

    const orderId = place()
    const order = queries.orderById(orderId)

    // Fire-and-forget emails
    sendOrderConfirmation(order).catch(console.error)
    sendNewOrderAdmin(order).catch(console.error)

    return reply.redirect(`/bestellung/erfolg/${order.order_number}`)
  })

  // GET /bestellung/erfolg/:number
  fastify.get('/bestellung/erfolg/:number', async (req, reply) => {
    const order = queries.orderByNumberOnly(req.params.number)
    if (!order) return reply.status(404).send('Bestellung nicht gefunden')
    const total = order.items.reduce((s, i) => s + i.subtotal, 0)
    return render(reply, 'shop/order_success.html', req, { order, total })
  })

  // GET /impressum
  fastify.get('/impressum', async (req, reply) => {
    return render(reply, 'shop/impressum.html', req, {})
  })

  // GET /datenschutz
  fastify.get('/datenschutz', async (req, reply) => {
    return render(reply, 'shop/datenschutz.html', req, {})
  })

  // GET /api/produkte
  fastify.get('/api/produkte', async () => {
    return queries.allActiveProducts.all()
  })

  // GET /api/produkte/:id
  fastify.get('/api/produkte/:id', async (req, reply) => {
    const p = queries.productById.get(parseInt(req.params.id))
    if (!p || !p.is_active) return reply.status(404).send({ error: 'Nicht gefunden' })
    return p
  })
}
