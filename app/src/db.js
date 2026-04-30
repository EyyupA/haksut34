import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import path from 'path'

const DB_PATH = process.env.DATABASE_PATH || './data/haksut34.db'
mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Tabellen sofort anlegen – bevor queries definiert werden
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_de TEXT NOT NULL,
      name_tr TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_de TEXT DEFAULT '',
      description_tr TEXT DEFAULT '',
      description_en TEXT DEFAULT '',
      price REAL NOT NULL,
      unit TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Sonstiges',
      image_url TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      stock INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      edit_token TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      customer_city TEXT NOT NULL,
      customer_zip TEXT NOT NULL,
      customer_country TEXT DEFAULT 'Deutschland',
      customer_note TEXT,
      status TEXT DEFAULT 'pending',
      is_paid INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      language TEXT DEFAULT 'de',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      product_price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      hashed_password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

initDb() // Tabellen anlegen bevor queries prepared werden

// ── Helpers ───────────────────────────────────────────────────────────────────

function booleanify(order) {
  if (!order) return null
  order.is_paid = Boolean(order.is_paid)
  order.is_locked = Boolean(order.is_locked)
  return order
}

function withItems(order) {
  if (!order) return null
  booleanify(order)
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id)
  return order
}

export const queries = {
  // Products
  allActiveProducts: db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY category, name_de'),
  allProducts: db.prepare('SELECT * FROM products ORDER BY category, name_de'),
  productById: db.prepare('SELECT * FROM products WHERE id = ?'),
  categories: db.prepare('SELECT DISTINCT category FROM products ORDER BY category'),
  insertProduct: db.prepare(`
    INSERT INTO products (name_de,name_tr,name_en,description_de,description_tr,description_en,price,unit,category,image_url,is_active,stock)
    VALUES (@name_de,@name_tr,@name_en,@description_de,@description_tr,@description_en,@price,@unit,@category,@image_url,@is_active,@stock)
  `),
  updateProduct: db.prepare(`
    UPDATE products SET name_de=@name_de,name_tr=@name_tr,name_en=@name_en,
      description_de=@description_de,description_tr=@description_tr,description_en=@description_en,
      price=@price,unit=@unit,category=@category,image_url=@image_url,is_active=@is_active,stock=@stock,
      updated_at=datetime('now')
    WHERE id=@id
  `),
  toggleProduct: db.prepare("UPDATE products SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id = ?"),
  deleteProduct: db.prepare('DELETE FROM products WHERE id = ?'),

  // Orders
  insertOrder: db.prepare(`
    INSERT INTO orders (order_number,edit_token,customer_name,customer_email,customer_phone,
      customer_address,customer_city,customer_zip,customer_country,customer_note,language)
    VALUES (@order_number,@edit_token,@customer_name,@customer_email,@customer_phone,
      @customer_address,@customer_city,@customer_zip,@customer_country,@customer_note,@language)
  `),
  insertOrderItem: db.prepare(`
    INSERT INTO order_items (order_id,product_id,product_name,product_price,quantity,subtotal)
    VALUES (@order_id,@product_id,@product_name,@product_price,@quantity,@subtotal)
  `),
  deleteOrderItems: db.prepare('DELETE FROM order_items WHERE order_id = ?'),

  orderByToken: (token) => withItems(db.prepare('SELECT * FROM orders WHERE edit_token = ?').get(token)),
  orderById: (id) => withItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)),
  orderByNumber: (nr, email) => withItems(
    db.prepare('SELECT * FROM orders WHERE order_number = ? AND customer_email = ?').get(nr, email)
  ),
  orderByNumberOnly: (nr) => withItems(db.prepare('SELECT * FROM orders WHERE order_number = ?').get(nr)),

  updateOrderStatus: db.prepare("UPDATE orders SET status=@status,updated_at=datetime('now') WHERE id=@id"),
  updateOrderLocked: db.prepare("UPDATE orders SET is_locked=@is_locked,status=@status,updated_at=datetime('now') WHERE id=@id"),
  updateOrderPaid: db.prepare("UPDATE orders SET is_paid=1,updated_at=datetime('now') WHERE id=?"),
  updateOrderUnpaid: db.prepare("UPDATE orders SET is_paid=0,updated_at=datetime('now') WHERE id=?"),
  updateOrderCustomer: db.prepare(`
    UPDATE orders SET customer_name=@customer_name,customer_phone=@customer_phone,
      customer_address=@customer_address,customer_city=@customer_city,customer_zip=@customer_zip,
      customer_note=@customer_note,updated_at=datetime('now')
    WHERE id=@id
  `),

  // Admin
  adminByUsername: db.prepare('SELECT * FROM admin_users WHERE username = ?'),
  insertAdmin: db.prepare('INSERT OR IGNORE INTO admin_users (username,hashed_password) VALUES (?,?)'),

  // Dashboard stats
  ordersToday: db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')"),
  openOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('pending','confirmed')"),
  unpaidOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE is_paid=0 AND status != 'cancelled'"),
  revenueAll: db.prepare("SELECT COALESCE(SUM(oi.subtotal),0) as v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status != 'cancelled'"),
  revenueMonth: db.prepare("SELECT COALESCE(SUM(oi.subtotal),0) as v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status != 'cancelled' AND strftime('%Y-%m',o.created_at) = strftime('%Y-%m','now')"),
  recentOrders: db.prepare(`
    SELECT o.*,
      COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id=o.id),0) as _total,
      (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as _item_count
    FROM orders o ORDER BY o.created_at DESC LIMIT 10
  `),
  filteredOrders: (where, params) => {
    const sql = `
      SELECT o.*,
        COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id=o.id),0) as _total,
        (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as _item_count
      FROM orders o
      ${where ? 'WHERE ' + where : ''}
      ORDER BY o.created_at DESC
    `
    return db.prepare(sql).all(...params).map(booleanify)
  },
  orderCities: db.prepare('SELECT DISTINCT customer_city FROM orders ORDER BY customer_city'),
}

// ── Seed ─────────────────────────────────────────────────────────────────────

export function seedProducts() {
  const { c } = db.prepare('SELECT COUNT(*) as c FROM products').get()
  if (c > 0) return

  const insert = db.transaction((items) => {
    for (const p of items) queries.insertProduct.run(p)
  })

  insert([
    { name_de:'Frische Büffelmilch', name_tr:'Taze Manda Sütü', name_en:'Fresh Buffalo Milk',
      description_de:'Frische Büffelmilch direkt vom Bauernhof – reich an Nährstoffen.',
      description_tr:'Çiftlikten taze manda sütü – besin değerleri yüksek.',
      description_en:'Fresh buffalo milk straight from the farm – rich in nutrients.',
      price:4.50, unit:'1 Liter', category:'Milchprodukte', image_url:'', is_active:1, stock:null },
    { name_de:'Büffeljoghurt', name_tr:'Manda Yoğurdu', name_en:'Buffalo Yogurt',
      description_de:'Cremiger Büffeljoghurt nach traditioneller Rezeptur.',
      description_tr:'Geleneksel tarife göre kremamsı manda yoğurdu.',
      description_en:'Creamy buffalo yogurt with traditional recipe.',
      price:6.00, unit:'500g', category:'Milchprodukte', image_url:'', is_active:1, stock:null },
    { name_de:'Büffelrahm (Kaymak)', name_tr:'Manda Kaymağı', name_en:'Buffalo Cream (Kaymak)',
      description_de:'Reichhaltiger Büffelrahm – perfekt zu Honig und Brot.',
      description_tr:'Zengin manda kaymağı – bal ve ekmekle mükemmel.',
      description_en:'Rich buffalo cream – perfect with honey and bread.',
      price:8.00, unit:'250g', category:'Milchprodukte', image_url:'', is_active:1, stock:null },
    { name_de:'Büffelbutter', name_tr:'Manda Tereyağı', name_en:'Buffalo Butter',
      description_de:'Handgemachte Büffelbutter – intensiver Geschmack.',
      description_tr:'El yapımı manda tereyağı – yoğun lezzet.',
      description_en:'Handmade buffalo butter – intense flavour.',
      price:9.50, unit:'250g', category:'Milchprodukte', image_url:'', is_active:1, stock:null },
    { name_de:'Anatolischer Honig', name_tr:'Anadolu Balı', name_en:'Anatolian Honey',
      description_de:'Naturreiner Wildblütenhonig aus den Bergen Anatoliens.',
      description_tr:"Anadolu'nun dağlarından saf yabani çiçek balı.",
      description_en:'Pure wild flower honey from the mountains of Anatolia.',
      price:12.00, unit:'500g', category:'Süßigkeiten', image_url:'', is_active:1, stock:null },
    { name_de:'Köy Peyniri (Dorfkäse)', name_tr:'Köy Peyniri', name_en:'Village Cheese',
      description_de:'Traditioneller weißer Käse aus Büffelmilch.',
      description_tr:'Manda sütünden geleneksel beyaz peynir.',
      description_en:'Traditional white cheese from buffalo milk.',
      price:11.00, unit:'500g', category:'Milchprodukte', image_url:'', is_active:1, stock:null },
  ])
  console.log('✅ 6 Produkte geseedet')
}
