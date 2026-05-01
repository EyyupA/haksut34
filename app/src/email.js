import nodemailer from 'nodemailer'
import nunjucks from 'nunjucks'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EMAILS_DIR = path.join(__dirname, '..', 'templates', 'emails')

const emailEnv = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(EMAILS_DIR),
  { autoescape: true }
)
// Currency filter also needed in email templates
emailEnv.addFilter('eur', (n) => `${Number(n).toFixed(2)} €`)

const DOMAIN = process.env.DOMAIN || 'localhost:8000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ''
const FROM_NAME = process.env.SMTP_FROM_NAME || 'Haksüt34'

function createTransporter() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  if (!host || !user || !pass) return null
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: { user, pass },
  })
}

async function send(to, subject, html) {
  const t = createTransporter()
  if (!t) {
    console.warn(`[email] SMTP nicht konfiguriert – überspringe Mail an ${to}: ${subject}`)
    return
  }
  try {
    await t.sendMail({ from: `"${FROM_NAME}" <${process.env.SMTP_USER}>`, to, subject, html })
    console.log(`[email] Gesendet an ${to}`)
  } catch (err) {
    console.error(`[email] Fehler beim Senden an ${to}:`, err.message)
  }
}

function orderCtx(order) {
  const total = (order.items || []).reduce((s, i) => s + i.subtotal, 0)
  return { order, total, edit_link: `https://${DOMAIN}/bestellung/aendern?token=${order.edit_token}`, domain: DOMAIN }
}

export async function sendOrderConfirmation(order) {
  const lang = order.language || 'tr'
  const ctx = orderCtx(order)
  let html
  try { html = emailEnv.render(`order_confirmation_${lang}.html`, ctx) }
  catch { html = emailEnv.render('order_confirmation_de.html', ctx) }
  await send(order.customer_email, `✅ Deine Bestellung #${order.order_number} – Haksüt34`, html)
}

export async function sendNewOrderAdmin(order) {
  if (!ADMIN_EMAIL) return
  const html = emailEnv.render('order_confirmation_de.html', orderCtx(order))
  await send(ADMIN_EMAIL, `🛒 Neue Bestellung #${order.order_number} von ${order.customer_name}`, html)
}

export async function sendOrderChanged(order) {
  const html = emailEnv.render('order_changed_de.html', orderCtx(order))
  await send(order.customer_email, `✏️ Bestellung #${order.order_number} geändert – Haksüt34`, html)
}

export async function sendOrderChangedAdmin(order) {
  if (!ADMIN_EMAIL) return
  const html = emailEnv.render('order_changed_de.html', orderCtx(order))
  await send(ADMIN_EMAIL, `✏️ Bestellung #${order.order_number} geändert`, html)
}

export async function sendOrderCancelled(order) {
  const html = emailEnv.render('order_cancelled_de.html', orderCtx(order))
  await send(order.customer_email, `❌ Bestellung #${order.order_number} storniert – Haksüt34`, html)
}
