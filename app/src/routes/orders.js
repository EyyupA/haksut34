import { db, queries } from '../db.js'
import { makeT } from '../i18n.js'
import { sendOrderChanged, sendOrderChangedAdmin, sendOrderCancelled } from '../email.js'

export default async function ordersRoutes(fastify) {
  const { render } = fastify

  // GET /bestellung/suchen
  fastify.get('/bestellung/suchen', async (req, reply) => {
    return render(reply, 'orders/lookup.html', req, { error: null })
  })

  // POST /bestellung/suchen
  fastify.post('/bestellung/suchen', async (req, reply) => {
    const { order_number, customer_email } = req.body
    const order = queries.orderByNumber(
      (order_number || '').trim().toUpperCase(),
      (customer_email || '').trim().toLowerCase()
    )
    if (!order) {
      const t = makeT(req.lang)
      return render(reply, 'orders/lookup.html', req, {
        error: t('lookup_hint'),
      })
    }
    return reply.redirect(`/bestellung/aendern?token=${order.edit_token}`)
  })

  // GET /bestellung/aendern?token=...
  fastify.get('/bestellung/aendern', async (req, reply) => {
    const { token } = req.query
    if (!token) return reply.status(400).send('Token fehlt')
    const order = queries.orderByToken(token)
    if (!order) return reply.status(404).send('Bestellung nicht gefunden')
    const total = order.items.reduce((s, i) => s + i.subtotal, 0)
    const locked = order.is_locked || ['cancelled', 'delivered'].includes(order.status)
    const products = locked ? [] : queries.allActiveProducts.all()
    return render(reply, 'orders/edit.html', req, { order, total, token, locked, products })
  })

  // POST /bestellung/aendern
  fastify.post('/bestellung/aendern', async (req, reply) => {
    const body = req.body
    const order = queries.orderByToken(body.token)
    if (!order) return reply.status(404).send('Bestellung nicht gefunden')
    if (order.is_locked || ['cancelled', 'delivered'].includes(order.status)) {
      return reply.status(403).send('Bestellung ist gesperrt')
    }

    let items
    try { items = JSON.parse(body.items_json || '[]') } catch { items = [] }

    const update = db.transaction(() => {
      queries.updateOrderCustomer.run({
        id: order.id,
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        customer_address: body.customer_address,
        customer_city: body.customer_city,
        customer_zip: body.customer_zip,
        customer_note: body.customer_note || null,
      })
      queries.deleteOrderItems.run(order.id)
      for (const item of items) {
        const qty = parseInt(item.quantity) || 0
        if (qty < 1) continue
        const product = queries.productById.get(item.product_id)
        if (!product) continue
        queries.insertOrderItem.run({
          order_id: order.id,
          product_id: product.id,
          product_name: item.name || product.name_de,
          product_price: product.price,
          quantity: qty,
          subtotal: Math.round(product.price * qty * 100) / 100,
        })
      }
    })
    update()

    const updated = queries.orderByToken(body.token)
    sendOrderChanged(updated).catch(console.error)
    sendOrderChangedAdmin(updated).catch(console.error)

    return reply.redirect(`/bestellung/bestaetigt?token=${body.token}`)
  })

  // GET /bestellung/bestaetigt
  fastify.get('/bestellung/bestaetigt', async (req, reply) => {
    const order = queries.orderByToken(req.query.token)
    if (!order) return reply.status(404).send('Bestellung nicht gefunden')
    const total = order.items.reduce((s, i) => s + i.subtotal, 0)
    return render(reply, 'orders/confirm.html', req, { order, total })
  })

  // POST /bestellung/stornieren
  fastify.post('/bestellung/stornieren', async (req, reply) => {
    const order = queries.orderByToken(req.body.token)
    if (!order) return reply.status(404).send('Bestellung nicht gefunden')
    if (order.is_locked || ['cancelled', 'delivered'].includes(order.status)) {
      return reply.status(403).send('Kann nicht storniert werden')
    }
    queries.updateOrderStatus.run({ id: order.id, status: 'cancelled' })
    const cancelled = queries.orderByToken(req.body.token)
    sendOrderCancelled(cancelled).catch(console.error)
    return render(reply, 'orders/cancelled.html', req, { order: cancelled })
  })
}
