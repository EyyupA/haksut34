import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/haksut34.db";
mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name_de TEXT NOT NULL,
      name_tr TEXT NOT NULL DEFAULT '',
      name_en TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pickup_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations: new columns added to existing tables
  try { db.exec(`ALTER TABLE orders ADD COLUMN pickup_point_id INTEGER`) } catch {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN pickup_point_name TEXT`) } catch {}
  try { db.exec(`ALTER TABLE products ADD COLUMN name_ar TEXT DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE products ADD COLUMN description_ar TEXT DEFAULT ''`) } catch {}
  try { db.exec(`ALTER TABLE categories ADD COLUMN name_ar TEXT DEFAULT ''`) } catch {}
}

initDb(); // Tabellen anlegen bevor queries prepared werden

// ── Helpers ───────────────────────────────────────────────────────────────────

function booleanify(order) {
  if (!order) return null;
  order.is_paid = Boolean(order.is_paid);
  order.is_locked = Boolean(order.is_locked);
  return order;
}

function withItems(order) {
  if (!order) return null;
  booleanify(order);
  order.items = db
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .all(order.id);
  return order;
}

export const queries = {
  // Products
  allActiveProducts: db.prepare(
    "SELECT * FROM products WHERE is_active = 1 ORDER BY category, name_de"
  ),
  allProducts: db.prepare("SELECT * FROM products ORDER BY category, name_de"),
  productById: db.prepare("SELECT * FROM products WHERE id = ?"),
  categories: db.prepare(
    "SELECT DISTINCT category FROM products ORDER BY category"
  ),
  insertProduct: db.prepare(`
    INSERT INTO products (name_de,name_tr,name_en,name_ar,description_de,description_tr,description_en,description_ar,price,unit,category,image_url,is_active,stock)
    VALUES (@name_de,@name_tr,@name_en,@name_ar,@description_de,@description_tr,@description_en,@description_ar,@price,@unit,@category,@image_url,@is_active,@stock)
  `),
  updateProduct: db.prepare(`
    UPDATE products SET name_de=@name_de,name_tr=@name_tr,name_en=@name_en,name_ar=@name_ar,
      description_de=@description_de,description_tr=@description_tr,description_en=@description_en,description_ar=@description_ar,
      price=@price,unit=@unit,category=@category,image_url=@image_url,is_active=@is_active,stock=@stock,
      updated_at=datetime('now')
    WHERE id=@id
  `),
  toggleProduct: db.prepare(
    "UPDATE products SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id = ?"
  ),
  deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),

  // Categories
  allCategories: db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products WHERE category = c.slug) as product_count
    FROM categories c ORDER BY c.sort_order, c.name_de
  `),
  categoryById: db.prepare("SELECT * FROM categories WHERE id = ?"),
  insertCategory: db.prepare(
    "INSERT INTO categories (slug,name_de,name_tr,name_en,name_ar,sort_order) VALUES (@slug,@name_de,@name_tr,@name_en,@name_ar,@sort_order)"
  ),
  updateCategory: db.prepare(
    "UPDATE categories SET name_de=@name_de,name_tr=@name_tr,name_en=@name_en,name_ar=@name_ar,sort_order=@sort_order WHERE id=@id"
  ),
  deleteCategory: db.prepare("DELETE FROM categories WHERE id = ?"),
  categoryProductCount: db.prepare(
    "SELECT COUNT(*) as c FROM products WHERE category = (SELECT slug FROM categories WHERE id = ?)"
  ),

  // Pickup points
  allActivePickupPoints: db.prepare("SELECT * FROM pickup_points WHERE is_active = 1 ORDER BY sort_order, name"),
  allPickupPoints: db.prepare("SELECT * FROM pickup_points ORDER BY sort_order, name"),
  pickupPointById: db.prepare("SELECT * FROM pickup_points WHERE id = ?"),
  insertPickupPoint: db.prepare(`
    INSERT INTO pickup_points (name,address,lat,lng,is_active,sort_order)
    VALUES (@name,@address,@lat,@lng,@is_active,@sort_order)
  `),
  updatePickupPoint: db.prepare(`
    UPDATE pickup_points SET name=@name,address=@address,lat=@lat,lng=@lng,is_active=@is_active,sort_order=@sort_order
    WHERE id=@id
  `),
  deletePickupPoint: db.prepare("DELETE FROM pickup_points WHERE id = ?"),

  // Orders
  insertOrder: db.prepare(`
    INSERT INTO orders (order_number,edit_token,customer_name,customer_email,customer_phone,
      customer_address,customer_city,customer_zip,customer_country,customer_note,language,
      pickup_point_id,pickup_point_name)
    VALUES (@order_number,@edit_token,@customer_name,@customer_email,@customer_phone,
      @customer_address,@customer_city,@customer_zip,@customer_country,@customer_note,@language,
      @pickup_point_id,@pickup_point_name)
  `),
  insertOrderItem: db.prepare(`
    INSERT INTO order_items (order_id,product_id,product_name,product_price,quantity,subtotal)
    VALUES (@order_id,@product_id,@product_name,@product_price,@quantity,@subtotal)
  `),
  deleteOrderItems: db.prepare("DELETE FROM order_items WHERE order_id = ?"),

  orderByToken: (token) =>
    withItems(
      db.prepare("SELECT * FROM orders WHERE edit_token = ?").get(token)
    ),
  orderById: (id) =>
    withItems(db.prepare("SELECT * FROM orders WHERE id = ?").get(id)),
  orderByNumber: (nr, email) =>
    withItems(
      db
        .prepare(
          "SELECT * FROM orders WHERE order_number = ? AND customer_email = ?"
        )
        .get(nr, email)
    ),
  orderByNumberOnly: (nr) =>
    withItems(
      db.prepare("SELECT * FROM orders WHERE order_number = ?").get(nr)
    ),

  updateOrderStatus: db.prepare(
    "UPDATE orders SET status=@status,updated_at=datetime('now') WHERE id=@id"
  ),
  updateOrderLocked: db.prepare(
    "UPDATE orders SET is_locked=@is_locked,status=@status,updated_at=datetime('now') WHERE id=@id"
  ),
  updateOrderPaid: db.prepare(
    "UPDATE orders SET is_paid=1,updated_at=datetime('now') WHERE id=?"
  ),
  updateOrderUnpaid: db.prepare(
    "UPDATE orders SET is_paid=0,updated_at=datetime('now') WHERE id=?"
  ),
  updateOrderCustomer: db.prepare(`
    UPDATE orders SET customer_name=@customer_name,customer_phone=@customer_phone,
      customer_address=@customer_address,customer_city=@customer_city,customer_zip=@customer_zip,
      customer_note=@customer_note,updated_at=datetime('now')
    WHERE id=@id
  `),

  // Admin
  adminByUsername: db.prepare("SELECT * FROM admin_users WHERE username = ?"),
  insertAdmin: db.prepare(
    "INSERT OR IGNORE INTO admin_users (username,hashed_password) VALUES (?,?)"
  ),

  // Dashboard stats
  ordersToday: db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')"
  ),
  openOrders: db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE status IN ('pending','confirmed')"
  ),
  unpaidOrders: db.prepare(
    "SELECT COUNT(*) as c FROM orders WHERE is_paid=0 AND status != 'cancelled'"
  ),
  revenueAll: db.prepare(
    "SELECT COALESCE(SUM(oi.subtotal),0) as v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status != 'cancelled'"
  ),
  revenueMonth: db.prepare(
    "SELECT COALESCE(SUM(oi.subtotal),0) as v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status != 'cancelled' AND strftime('%Y-%m',o.created_at) = strftime('%Y-%m','now')"
  ),
  recentOrders: db.prepare(`
    SELECT o.*,
      COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id=o.id),0) as _total,
      (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as _item_count
    FROM orders o ORDER BY o.created_at DESC LIMIT 10
  `),
  filteredOrders: (where, params, orderBy = 'o.created_at DESC') => {
    const sql = `
      SELECT o.*,
        COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id=o.id),0) as _total,
        (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as _item_count
      FROM orders o
      ${where ? "WHERE " + where : ""}
      ORDER BY ${orderBy}
    `;
    return db
      .prepare(sql)
      .all(...params)
      .map(booleanify);
  },
  orderCities: db.prepare(
    "SELECT DISTINCT customer_city FROM orders ORDER BY customer_city"
  ),
  orderPickupPoints: db.prepare(
    "SELECT DISTINCT pickup_point_name FROM orders WHERE pickup_point_name IS NOT NULL ORDER BY pickup_point_name"
  ),

  // Reports
  reportOrdersByStatus: db.prepare(
    "SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC"
  ),
  reportRevenueByMonth: db.prepare(`
    SELECT strftime('%Y-%m', o.created_at) as month,
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(oi.subtotal), 0) as revenue
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `),
  reportTopProducts: db.prepare(`
    SELECT oi.product_name,
      SUM(oi.quantity) as total_qty,
      COALESCE(SUM(oi.subtotal), 0) as total_revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 10
  `),
  reportByPickupPoint: db.prepare(`
    SELECT COALESCE(o.pickup_point_name, 'Nicht angegeben') as pickup_point,
      COUNT(DISTINCT o.id) as order_count,
      COALESCE(SUM(oi.subtotal), 0) as revenue
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
    GROUP BY o.pickup_point_name ORDER BY order_count DESC
  `),
  reportAllOrdersCSV: db.prepare(`
    SELECT o.order_number, o.created_at, o.customer_name, o.customer_email,
      o.customer_phone, o.customer_city, o.customer_zip, o.status,
      CASE WHEN o.is_paid=1 THEN 'Ja' ELSE 'Nein' END as bezahlt,
      COALESCE(o.pickup_point_name,'') as abholpunkt,
      COALESCE((SELECT SUM(subtotal) FROM order_items WHERE order_id=o.id),0) as gesamt
    FROM orders o ORDER BY o.created_at DESC
  `),
};

// ── Seed ─────────────────────────────────────────────────────────────────────

const IMG = {
  milk: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&h=300&fit=crop&q=80",
  yogurt:
    "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=300&fit=crop&q=80",
  kaymak:
    "https://images.unsplash.com/photo-1547592180-85f173990554?w=400&h=300&fit=crop&q=80",
  white_cheese:
    "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=400&h=300&fit=crop&q=80",
  soft_cheese:
    "https://images.unsplash.com/photo-1559561853-08451507cbe7?w=400&h=300&fit=crop&q=80",
  hard_cheese:
    "https://images.unsplash.com/photo-1452195100486-9cc805987862?w=400&h=300&fit=crop&q=80",
  string_cheese:
    "https://plus.unsplash.com/premium_photo-1691939610797-aba18030c15f?q=80&w=844&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  tulum:
    "https://images.unsplash.com/photo-1589881133825-bca411a22f4d?w=400&h=300&fit=crop&q=80",
  butter:
    "https://images.unsplash.com/photo-1589881133825-bca411a22f4d?w=400&h=300&fit=crop&q=80",
  olive_oil:
    "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&h=300&fit=crop&q=80",
  olives:
    "https://images.unsplash.com/photo-1601043813988-3b3a68fb2ae9?w=400&h=300&fit=crop&q=80",
  honey_raw:
    "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=400&h=300&fit=crop&q=80",
  honeycomb:
    "https://images.unsplash.com/photo-1471943038886-69c3e84c8b33?w=400&h=300&fit=crop&q=80",
  honey_dark:
    "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&h=300&fit=crop&q=80",
  borek:
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=300&fit=crop&q=80",
  manti:
    "https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=400&h=300&fit=crop&q=80",
  yufka:
    "https://images.unsplash.com/photo-1574966739987-65ac3b2e3c74?w=400&h=300&fit=crop&q=80",
};

export function seedProducts() {
  const { c } = db.prepare("SELECT COUNT(*) as c FROM products").get();
  if (c > 0) return;

  const insert = db.transaction((items) => {
    for (const p of items) queries.insertProduct.run({ name_ar: '', description_ar: '', ...p });
  });

  insert([
    // ── Milchprodukte (Hollanda) ───────────────────────────────────────────
    {
      name_de: "Büffelmilch",
      name_tr: "Manda Sütü",
      name_en: "Buffalo Milk",
      description_de:
        "Frische Büffelmilch aus Holland – besonders cremig und nährstoffreich.",
      description_tr:
        "Hollanda'dan taze manda sütü – özellikle kremsi ve besin değeri yüksek.",
      description_en:
        "Fresh buffalo milk from Holland – exceptionally creamy and nutritious.",
      price: 12.5,
      unit: "3 Liter",
      category: "Milchprodukte",
      image_url: IMG.milk,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Büffeljoghurt",
      name_tr: "Manda Yoğurdu",
      name_en: "Buffalo Yogurt",
      description_de:
        "Dickrahmiger Büffeljoghurt – natürlich und ohne Zusatzstoffe.",
      description_tr: "Yoğun kremali manda yoğurdu – doğal ve katkısız.",
      description_en: "Thick creamy buffalo yogurt – natural, no additives.",
      price: 6.5,
      unit: "1 kg",
      category: "Milchprodukte",
      image_url: IMG.yogurt,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Büffelrahm (Kaymak)",
      name_tr: "Manda Kaymağı",
      name_en: "Buffalo Cream (Kaymak)",
      description_de:
        "Samtig-dicker Büffelrahm – traditionell zu Honig und frischem Brot.",
      description_tr:
        "Kadifemsi manda kaymağı – geleneksel olarak bal ve taze ekmekle.",
      description_en:
        "Velvety thick buffalo cream – traditionally served with honey and fresh bread.",
      price: 10.5,
      unit: "200 g",
      category: "Milchprodukte",
      image_url: IMG.kaymak,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Frischer Büffelkäse",
      name_tr: "Manda Taze Peyniri",
      name_en: "Fresh Buffalo Cheese",
      description_de:
        "Weicher, frischer Weißkäse aus Büffelmilch – mild und aromatisch.",
      description_tr:
        "Büffel sütünden yumuşak taze beyaz peynir – hafif ve aromatik.",
      description_en:
        "Soft fresh white cheese from buffalo milk – mild and aromatic.",
      price: 14.5,
      unit: "500 g",
      category: "Milchprodukte",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Büffel-Lor-Käse",
      name_tr: "Manda Lor Peyniri",
      name_en: "Buffalo Lor Cheese",
      description_de:
        "Frischer Lor-Käse aus Büffelmilch – leicht, cremig, ideal zum Frühstück.",
      description_tr:
        "Manda sütünden taze lor peyniri – hafif, kremsi, kahvaltı için ideal.",
      description_en:
        "Fresh lor cheese from buffalo milk – light, creamy, ideal for breakfast.",
      price: 4.5,
      unit: "300 g",
      category: "Milchprodukte",
      image_url: IMG.soft_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Ziegenmilch",
      name_tr: "Keçi Sütü",
      name_en: "Goat Milk",
      description_de:
        "Frische Ziegenmilch aus Holland – leicht verdaulich und nährstoffreich.",
      description_tr:
        "Hollanda'dan taze keçi sütü – kolay sindirilebilir ve besleyici.",
      description_en:
        "Fresh goat milk from Holland – easily digestible and nutritious.",
      price: 10.5,
      unit: "3 Liter",
      category: "Milchprodukte",
      image_url: IMG.milk,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Ziegenjoghurt",
      name_tr: "Keçi Yoğurdu",
      name_en: "Goat Yogurt",
      description_de: "Naturjoghurt aus Ziegenmilch – leicht und bekömmlich.",
      description_tr: "Keçi sütünden sade yoğurt – hafif ve sindirimi kolay.",
      description_en:
        "Natural yogurt from goat milk – light and easily digestible.",
      price: 4.5,
      unit: "500 g",
      category: "Milchprodukte",
      image_url: IMG.yogurt,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Ziegen-Kaşar-Käse",
      name_tr: "Keçi Kaşarı",
      name_en: "Goat Kashar Cheese",
      description_de:
        "Halbharter Kaşar-Käse aus Ziegenmilch – würzig und schmelzend.",
      description_tr:
        "Keçi sütünden yarı sert kaşar peyniri – lezzetli ve eriyebilir.",
      description_en:
        "Semi-hard kashar cheese from goat milk – flavourful and melting.",
      price: 13.5,
      unit: "500 g",
      category: "Milchprodukte",
      image_url: IMG.hard_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Weißer Ziegenkäse",
      name_tr: "Keçi Beyaz Peyniri",
      name_en: "Goat White Cheese",
      description_de:
        "Klassischer weißer Käse aus Ziegenmilch – fein-salzig und cremig.",
      description_tr:
        "Keçi sütünden klasik beyaz peynir – hafif tuzlu ve kremsi.",
      description_en:
        "Classic white cheese from goat milk – delicately salty and creamy.",
      price: 13.5,
      unit: "500 g",
      category: "Milchprodukte",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Frischer Ziegenkäse",
      name_tr: "Taze Keçi Peyniri",
      name_en: "Fresh Goat Cheese",
      description_de:
        "Kleiner frischer Ziegenkäse – zart und vielseitig einsetzbar.",
      description_tr:
        "Küçük taze keçi peyniri – narin ve çok yönlü kullanımlı.",
      description_en: "Small fresh goat cheese – delicate and versatile.",
      price: 3.5,
      unit: "100 g",
      category: "Milchprodukte",
      image_url: IMG.soft_cheese,
      is_active: 1,
      stock: null,
    },

    // ── Yöresel Türkische Käsesorten ──────────────────────────────────────
    {
      name_de: "Schwarzmeer-Butter (Karadeniz)",
      name_tr: "Karadeniz Tereyağı",
      name_en: "Black Sea Butter",
      description_de:
        "Traditionelle Butterspezialität aus der Schwarzmeerregion – intensiv im Geschmack.",
      description_tr:
        "Karadeniz yöresine özgü geleneksel tereyağı – yoğun aromalı.",
      description_en:
        "Traditional butter speciality from the Black Sea region – intense in flavour.",
      price: 16.0,
      unit: "1 kg",
      category: "Türkische Käsesorten",
      image_url: IMG.butter,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Yörük-Dorfkäse (frisch)",
      name_tr: "Taze Yörük Köy Peyniri",
      name_en: "Fresh Nomad Village Cheese",
      description_de:
        "Frischer Weißkäse nach Nomaden-Art – handgemacht aus Rohmilch.",
      description_tr: "Yörük usulü taze köy peyniri – çiğ sütten el yapımı.",
      description_en:
        "Fresh white cheese in nomadic style – handmade from raw milk.",
      price: 13.5,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Kräuter-Dorfkäse (Otlu)",
      name_tr: "Otlu Taze Köy Peyniri",
      name_en: "Herb Village Cheese",
      description_de:
        "Frischer Dorfkäse mit aromatischen Bergkräutern – typisch ostanatolisch.",
      description_tr:
        "Dağ otları ile aromalı taze köy peyniri – tipik Doğu Anadolu lezzeti.",
      description_en:
        "Fresh village cheese with aromatic mountain herbs – typical East Anatolian.",
      price: 13.5,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Kuymak-Käse (Schmelzkäse)",
      name_tr: "Kuymak Peyniri",
      name_en: "Kuymak Melting Cheese",
      description_de:
        "Weicher Käse ideal zum Schmelzen – perfekt für traditionelles Kuymak-Gericht.",
      description_tr:
        "Kuymak yapmak için ideal yumuşak peynir – geleneksel lezzet.",
      description_en:
        "Soft cheese ideal for melting – perfect for the traditional kuymak dish.",
      price: 15.0,
      unit: "800 g",
      category: "Türkische Käsesorten",
      image_url: IMG.soft_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Fadenkäse mit Çökelek",
      name_tr: "Çökelekli Tel Peyniri",
      name_en: "String Cheese with Çökelek",
      description_de:
        "Gezogener Fadenkäse mit Çökelek-Füllung – handwerklich hergestellt.",
      description_tr: "Çökelek dolgulu el yapımı tel peyniri.",
      description_en:
        "Pulled string cheese with çökelek filling – artisanally crafted.",
      price: 15.0,
      unit: "800 g",
      category: "Türkische Käsesorten",
      image_url: IMG.string_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Örgü-Käse (geflochten)",
      name_tr: "Örgü Peyniri",
      name_en: "Braided Cheese",
      description_de:
        "Geflochtener Käse nach türkischer Tradition – zart und faserig.",
      description_tr: "Geleneksel Türk usulü örgü peyniri – narin ve lifli.",
      description_en:
        "Braided cheese in Turkish tradition – tender and fibrous.",
      price: 15.0,
      unit: "800 g",
      category: "Türkische Käsesorten",
      image_url: IMG.string_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Dil-Käse (Zungenkäse)",
      name_tr: "Dil Peyniri",
      name_en: "Dil String Cheese",
      description_de:
        "Milder, faserig-weicher Käse – ideal als Snack oder zum Frühstück.",
      description_tr:
        "Hafif, lifli ve yumuşak peynir – atıştırmalık veya kahvaltı için ideal.",
      description_en:
        "Mild, fibrous-soft cheese – ideal as a snack or for breakfast.",
      price: 15.0,
      unit: "800 g",
      category: "Türkische Käsesorten",
      image_url: IMG.string_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Bidon-Tulum-Käse",
      name_tr: "Bidon Tulum Peyniri",
      name_en: "Bidon Tulum Cheese",
      description_de:
        "Gereifter Tulum-Käse im Kanister – kräftig, würzig, charaktervoll.",
      description_tr:
        "Bidon içinde olgunlaştırılmış tulum peyniri – güçlü ve baharatlı.",
      description_en:
        "Aged tulum cheese in canister – bold, spicy, full of character.",
      price: 18.5,
      unit: "1 kg",
      category: "Türkische Käsesorten",
      image_url: IMG.tulum,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Cecil-Fadenkäse 800g",
      name_tr: "Cecil Tel Peyniri 800g",
      name_en: "Cecil String Cheese 800g",
      description_de:
        "Armenisch-türkischer Cecil-Käse – faserig, mild und aromatisch.",
      description_tr: "Ermeni-Türk Cecil peyniri – lifli, hafif ve aromatik.",
      description_en:
        "Armenian-Turkish Cecil cheese – fibrous, mild and aromatic.",
      price: 15.0,
      unit: "800 g",
      category: "Türkische Käsesorten",
      image_url: IMG.string_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Cecil-Fadenkäse 400g",
      name_tr: "Cecil Tel Peyniri 400g",
      name_en: "Cecil String Cheese 400g",
      description_de:
        "Armenisch-türkischer Cecil-Käse – faserig, mild und aromatisch.",
      description_tr: "Ermeni-Türk Cecil peyniri – lifli, hafif ve aromatik.",
      description_en:
        "Armenian-Turkish Cecil cheese – fibrous, mild and aromatic.",
      price: 8.5,
      unit: "400 g",
      category: "Türkische Käsesorten",
      image_url: IMG.string_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Butter",
      name_tr: "Tereyağı",
      name_en: "Butter",
      description_de: "Naturbelassene Butter – cremig und vollmundig.",
      description_tr: "Doğal sade tereyağı – kremsi ve dolgun aromalı.",
      description_en: "Natural butter – creamy and full-flavoured.",
      price: 9.0,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.butter,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Ezine-Käse",
      name_tr: "Ezine Peyniri",
      name_en: "Ezine Cheese",
      description_de:
        "Legendärer Weißkäse aus Ezine – g.U.-geschützt, vollmundig und salzig.",
      description_tr:
        "Efsanevi Ezine peyniri – coğrafi işaretli, dolgun ve tuzlu.",
      description_en:
        "Legendary white cheese from Ezine – PDO-protected, full-bodied and salty.",
      price: 16.0,
      unit: "600 g",
      category: "Türkische Käsesorten",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Korbkäse (Sepet)",
      name_tr: "Sepet Peyniri",
      name_en: "Basket Cheese",
      description_de:
        "Im Weidenkorb gereifter Weißkäse – feine Korbstruktur, würzig-salzig.",
      description_tr:
        "Hasır sepette olgunlaştırılmış beyaz peynir – ince sepet dokusu, baharatlı-tuzlu.",
      description_en:
        "White cheese aged in a wicker basket – fine basket texture, spicy-salty.",
      price: 13.5,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Gereifter Kars-Kaşar",
      name_tr: "Kars Kaşarı (Eskitilmiş)",
      name_en: "Aged Kars Kashar",
      description_de:
        "Traditionell gereifter Kaşar-Käse aus Kars – intensiv, nussig, unverwechselbar.",
      description_tr:
        "Kars'tan geleneksel olgunlaştırılmış kaşar – yoğun, fındıksı, eşsiz.",
      description_en:
        "Traditionally aged kashar cheese from Kars – intense, nutty, unmistakeable.",
      price: 14.0,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.hard_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Van-Kräuterkäse (Otlu)",
      name_tr: "Van Otlu Peyniri",
      name_en: "Van Herb Cheese",
      description_de:
        "Weißkäse aus Van mit aromatischen Wildkräutern – frühlingshaft und würzig.",
      description_tr:
        "Van yöresine özgü yabani otlu beyaz peynir – bahar aromalı ve baharatlı.",
      description_en:
        "White cheese from Van with aromatic wild herbs – fresh and spicy.",
      price: 13.5,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.white_cheese,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Erzincan-Tulum-Käse",
      name_tr: "Erzincan Tulum Peyniri",
      name_en: "Erzincan Tulum Cheese",
      description_de:
        "Gereifter Tulum-Käse aus Erzincan – kräftig aromatisch und leicht krümelig.",
      description_tr:
        "Erzincan tulum peyniri – kuvvetli aromalı ve hafif ufalanan.",
      description_en:
        "Aged tulum cheese from Erzincan – boldly aromatic and slightly crumbly.",
      price: 13.5,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.tulum,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Schwarzkümmel-Tulum-Käse",
      name_tr: "Çörekotlu İnek Tulum Peyniri",
      name_en: "Nigella Seed Tulum Cheese",
      description_de:
        "Kuhmilch-Tulum-Käse mit Schwarzkümmel – aromatisch und charaktervoll.",
      description_tr:
        "Çörekotlu inek sütü tulum peyniri – aromatik ve karakterli.",
      description_en:
        "Cow milk tulum cheese with nigella seeds – aromatic and full of character.",
      price: 12.0,
      unit: "500 g",
      category: "Türkische Käsesorten",
      image_url: IMG.tulum,
      is_active: 1,
      stock: null,
    },

    // ── Backwaren ─────────────────────────────────────────────────────────
    {
      name_de: "Wasserbörek rund",
      name_tr: "Su Böreği (Yuvarlak)",
      name_en: "Water Börek (Round)",
      description_de:
        "Hausgemachter Wasserbörek in runder Form – knusprig außen, saftig innen.",
      description_tr: "Ev yapımı yuvarlak su böreği – dışı çıtır, içi sulu.",
      description_en:
        "Homemade water börek in round shape – crispy outside, juicy inside.",
      price: 18.0,
      unit: "1700 g",
      category: "Backwaren",
      image_url: IMG.borek,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Wasserbörek eckig",
      name_tr: "Su Böreği (Dörtgen)",
      name_en: "Water Börek (Square)",
      description_de:
        "Hausgemachter Wasserbörek in rechteckiger Form – klassisch und saftig.",
      description_tr: "Ev yapımı dörtgen su böreği – klasik ve sulu.",
      description_en:
        "Homemade water börek in rectangular shape – classic and juicy.",
      price: 16.0,
      unit: "2 kg",
      category: "Backwaren",
      image_url: IMG.borek,
      is_active: 1,
      stock: null,
    },
    {
      name_de: 'Hackfleisch-Manti „Tuna"',
      name_tr: 'Kıymalı Mantı „Tuna"',
      name_en: 'Meat Manti "Tuna"',
      description_de:
        'Türkische Teigtaschen mit Hackfleisch „Tuna" – servierbereit, einzufrieren.',
      description_tr: '„Tuna" kıymalı Türk mantısı – hazır, dondurucuya uygun.',
      description_en:
        'Turkish dumplings with meat filling "Tuna" – ready to cook, freezer-suitable.',
      price: 10.5,
      unit: "1 kg",
      category: "Backwaren",
      image_url: IMG.manti,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Frisches Dorfyufka (5er-Pack)",
      name_tr: "Taze Köy Yufkası (5'li)",
      name_en: "Fresh Village Yufka (5-Pack)",
      description_de:
        "Hauchdünnes Yufka-Fladenbrot aus dem Dorf – frisch und flexibel.",
      description_tr: "Köyden taze, ince köy yufkası – taze ve esnek.",
      description_en: "Paper-thin village yufka flatbread – fresh and pliable.",
      price: 6.5,
      unit: "5er-Pack",
      category: "Backwaren",
      image_url: IMG.yufka,
      is_active: 1,
      stock: null,
    },

    // ── Oliven & Öl ───────────────────────────────────────────────────────
    {
      name_de: "Kaltgepresstes Olivenöl 5 L",
      name_tr: "Soğuk Sıkım Zeytinyağı 5L",
      name_en: "Cold Pressed Olive Oil 5L",
      description_de:
        "Natives Olivenöl extra – direkt kaltgepresst, fruchtig und aromatisch.",
      description_tr: "Soğuk sıkım sızma zeytinyağı – meyveli ve aromatik.",
      description_en:
        "Extra virgin olive oil – cold-pressed, fruity and aromatic.",
      price: 65.0,
      unit: "5 Liter",
      category: "Oliven & Öl",
      image_url: IMG.olive_oil,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Kaltgepresstes Olivenöl 1 L",
      name_tr: "Soğuk Sıkım Zeytinyağı 1L",
      name_en: "Cold Pressed Olive Oil 1L",
      description_de:
        "Natives Olivenöl extra in der Flasche – direkt kaltgepresst, fruchtig und aromatisch.",
      description_tr:
        "Şişede soğuk sıkım sızma zeytinyağı – meyveli ve aromatik.",
      description_en:
        "Extra virgin olive oil in bottle – cold-pressed, fruity and aromatic.",
      price: 12.5,
      unit: "1 Liter",
      category: "Oliven & Öl",
      image_url: IMG.olive_oil,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Gemischte Oliven (Schwarz & Grün)",
      name_tr: "Siyah ve Yeşil Zeytinler",
      name_en: "Mixed Olives (Black & Green)",
      description_de:
        "Sortiment schwarzer und grüner Oliven – würzig mariniert, typisch mediterran.",
      description_tr:
        "Siyah ve yeşil zeytin karışımı – baharatlı marine, tipik Akdeniz lezzeti.",
      description_en:
        "Assortment of black and green olives – spiced marinade, typically Mediterranean.",
      price: 12.0,
      unit: "900 g",
      category: "Oliven & Öl",
      image_url: IMG.olives,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Oliven-Eimer (Schwarz & Grün)",
      name_tr: "Kova Siyah ve Yeşil Zeytinler",
      name_en: "Olives Bucket (Black & Green)",
      description_de:
        "Großer Eimer gemischter Oliven – für die ganze Familie oder den Vorrat.",
      description_tr:
        "Büyük kova karışık zeytin – tüm aile için veya stok amaçlı.",
      description_en:
        "Large bucket of mixed olives – for the whole family or stocking up.",
      price: 35.0,
      unit: "3,5 kg",
      category: "Oliven & Öl",
      image_url: IMG.olives,
      is_active: 1,
      stock: null,
    },

    // ── Honig (Sivas Yöresi) ──────────────────────────────────────────────
    {
      name_de: "Karakovan-Wildhonig",
      name_tr: "Karakovan Balı",
      name_en: "Karakovan Wild Honey",
      description_de:
        "Ursprünglicher Blockhöhlen-Honig aus der Region Sivas – roh, ungefiltert, intensiv.",
      description_tr:
        "Sivas yöresinden ham, süzülmemiş karakovan balı – yoğun aromalı.",
      description_en:
        "Raw log-hive honey from the Sivas region – unfiltered, intense, prized.",
      price: 35.0,
      unit: "1 kg",
      category: "Honig",
      image_url: IMG.honeycomb,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Wabenhonig dunkel (Petek Çıta)",
      name_tr: "Petek Çıta Bal (Koyu Renk)",
      name_en: "Dark Comb Honey",
      description_de:
        "Dunkler Wabenhonig aus Sivas – kräftig aromatisch, essbar mit Wabe.",
      description_tr:
        "Sivas'tan koyu renkli petek çıta bal – kuvvetli aromalı, peteğiyle yenebilir.",
      description_en:
        "Dark comb honey from Sivas – boldly aromatic, edible with comb.",
      price: 25.0,
      unit: "1 kg",
      category: "Honig",
      image_url: IMG.honey_dark,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Wabenhonig hell (Açık Çıta)",
      name_tr: "Açık Çıta Bal (Açık Renk)",
      name_en: "Light Comb Honey",
      description_de:
        "Heller, milder Wabenhonig aus Sivas – floral, fein, mit essbarer Wabe.",
      description_tr:
        "Sivas'tan açık renkli çıta bal – çiçeksi, ince aromalı, peteğiyle.",
      description_en:
        "Light, mild comb honey from Sivas – floral, delicate, with edible comb.",
      price: 25.0,
      unit: "1 kg",
      category: "Honig",
      image_url: IMG.honey_raw,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Kastanienhonig",
      name_tr: "Kestane Balı",
      name_en: "Chestnut Honey",
      description_de:
        "Intensiver Kastanienhonig aus der Region Sivas – dunkel, leicht bitter, charaktervoll.",
      description_tr:
        "Sivas yöresinden yoğun kestane balı – koyu, hafif acı, karakterli.",
      description_en:
        "Intense chestnut honey from the Sivas region – dark, slightly bitter, full of character.",
      price: 13.0,
      unit: "500 g",
      category: "Honig",
      image_url: IMG.honey_dark,
      is_active: 1,
      stock: null,
    },
  ]);
  console.log("✅ 39 Produkte geseedet");
}

export function seedArabicNames() {
  const products = [
    { name_de: 'Büffelmilch',                  name_ar: 'حليب الجاموس',            description_ar: 'حليب جاموس طازج من هولندا – كريمي بشكل استثنائي وغني بالمغذيات.' },
    { name_de: 'Büffeljoghurt',                name_ar: 'زبادي الجاموس',           description_ar: 'زبادي الجاموس كثيف القشدة – طبيعي وخالٍ من المضافات.' },
    { name_de: 'Büffelrahm (Kaymak)',          name_ar: 'قشدة الجاموس (قيمق)',     description_ar: 'قشدة جاموس ناعمة وكثيفة – تُقدَّم تقليدياً مع العسل والخبز الطازج.' },
    { name_de: 'Frischer Büffelkäse',          name_ar: 'جبن جاموس طازج',          description_ar: 'جبن أبيض طري وطازج من حليب الجاموس – خفيف الطعم وعطري.' },
    { name_de: 'Büffel-Lor-Käse',             name_ar: 'جبن لور الجاموس',          description_ar: 'جبن لور طازج من حليب الجاموس – خفيف وكريمي، مثالي لوجبة الفطور.' },
    { name_de: 'Ziegenmilch',                  name_ar: 'حليب الماعز',              description_ar: 'حليب ماعز طازج من هولندا – سهل الهضم وغني بالمغذيات.' },
    { name_de: 'Ziegenjoghurt',                name_ar: 'زبادي الماعز',             description_ar: 'زبادي طبيعي من حليب الماعز – خفيف وسهل الهضم.' },
    { name_de: 'Ziegen-Kaşar-Käse',           name_ar: 'جبن كاشار الماعز',         description_ar: 'جبن كاشار نصف صلب من حليب الماعز – حار الطعم وينذاب بسهولة.' },
    { name_de: 'Weißer Ziegenkäse',            name_ar: 'جبن أبيض من الماعز',       description_ar: 'جبن أبيض كلاسيكي من حليب الماعز – خفيف المذاق المالح وكريمي.' },
    { name_de: 'Frischer Ziegenkäse',          name_ar: 'جبن ماعز طازج',            description_ar: 'جبن ماعز طازج صغير – ناعم ومتعدد الاستخدامات.' },
    { name_de: 'Schwarzmeer-Butter (Karadeniz)', name_ar: 'زبدة البحر الأسود',    description_ar: 'زبدة تقليدية مميزة من منطقة البحر الأسود – غنية النكهة بشكل استثنائي.' },
    { name_de: 'Yörük-Dorfkäse (frisch)',      name_ar: 'جبن قرية يوروك (طازج)',    description_ar: 'جبن أبيض طازج على طريقة الرحّالة – مصنوع يدوياً من حليب خام.' },
    { name_de: 'Kräuter-Dorfkäse (Otlu)',      name_ar: 'جبن القرية بالأعشاب',      description_ar: 'جبن قرية طازج بالأعشاب الجبلية العطرية – نموذجي لشرق الأناضول.' },
    { name_de: 'Kuymak-Käse (Schmelzkäse)',    name_ar: 'جبن كويماك (جبن ذائب)',    description_ar: 'جبن طري مثالي للإذابة – مثالي لطبق الكويماك التقليدي.' },
    { name_de: 'Fadenkäse mit Çökelek',        name_ar: 'جبن الخيوط مع جوكيليك',   description_ar: 'جبن خيوط ممتد محشو بجوكيليك – مصنوع بطريقة حرفية يدوية.' },
    { name_de: 'Örgü-Käse (geflochten)',       name_ar: 'جبن مضفور',                description_ar: 'جبن مضفور على الطريقة التركية التقليدية – ناعم وليفي.' },
    { name_de: 'Dil-Käse (Zungenkäse)',        name_ar: 'جبن الدل (جبن اللسان)',    description_ar: 'جبن خفيف وليفي وطري – مثالي كوجبة خفيفة أو لوجبة الفطور.' },
    { name_de: 'Bidon-Tulum-Käse',            name_ar: 'جبن تولوم في بيدون',        description_ar: 'جبن تولوم مُعتَّق في وعاء معدني – قوي الطعم وعطري ومميز.' },
    { name_de: 'Cecil-Fadenkäse 800g',         name_ar: 'جبن سيسيل خيوط 800 غرام', description_ar: 'جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.' },
    { name_de: 'Cecil-Fadenkäse 400g',         name_ar: 'جبن سيسيل خيوط 400 غرام', description_ar: 'جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.' },
    { name_de: 'Butter',                       name_ar: 'زبدة',                     description_ar: 'زبدة طبيعية – كريمية وغنية المذاق.' },
    { name_de: 'Ezine-Käse',                   name_ar: 'جبن أزين',                  description_ar: 'جبن أبيض أسطوري من أزين – محمي بمؤشر جغرافي، غني المذاق ومالح.' },
    { name_de: 'Korbkäse (Sepet)',             name_ar: 'جبن السلة (سيبت)',          description_ar: 'جبن أبيض مُعتَّق في سلة صفصاف – بنية سلة دقيقة، عطري ومالح.' },
    { name_de: 'Gereifter Kars-Kaşar',        name_ar: 'كاشار كارس المُعتَّق',       description_ar: 'جبن كاشار مُعتَّق تقليدياً من كارس – مكثف ومذاق جوزي لا يُضاهى.' },
    { name_de: 'Van-Kräuterkäse (Otlu)',       name_ar: 'جبن أعشاب فان',             description_ar: 'جبن أبيض من فان بأعشاب برية عطرية – ربيعي الطعم وحار.' },
    { name_de: 'Erzincan-Tulum-Käse',         name_ar: 'جبن تولوم أرزينجان',         description_ar: 'جبن تولوم مُعتَّق من أرزينجان – قوي العطر وهش قليلاً.' },
    { name_de: 'Schwarzkümmel-Tulum-Käse',    name_ar: 'جبن تولوم بالحبة السوداء',   description_ar: 'جبن تولوم بالحبة السوداء – عطري ومميز الطعم.' },
    { name_de: 'Wasserbörek rund',             name_ar: 'بورك الماء (دائري)',         description_ar: 'بورك الماء محلي الصنع بشكل دائري – مقرمش من الخارج وطري من الداخل.' },
    { name_de: 'Wasserbörek eckig',            name_ar: 'بورك الماء (مستطيل)',        description_ar: 'بورك الماء محلي الصنع بشكل مستطيل – كلاسيكي وطري.' },
    { name_de: 'Olivenöl (Nativ Extra)',       name_ar: 'زيت زيتون بكر ممتاز',       description_ar: 'زيت زيتون بكر ممتاز معصور بالبرد – ذهبي مخضر وعطري.' },
    { name_de: 'Schwarze Oliven (Gemlik)',     name_ar: 'زيتون أسود (جمليك)',         description_ar: 'زيتون أسود مُعتَّق طبيعياً من جمليك – خفيف الطعم ولحمي.' },
    { name_de: 'Grüne Oliven (Çizik)',         name_ar: 'زيتون أخضر (شيزيك)',        description_ar: 'زيتون أخضر مشقوق بالثوم والأعشاب – حار ومقرمش.' },
    { name_de: 'Rohhonig (Naturhonig)',        name_ar: 'عسل خام طبيعي',             description_ar: 'عسل بري غير معالج من جبال الأناضول – خام وطبيعي وعطري.' },
    { name_de: 'Wabenhonig',                   name_ar: 'عسل الشمع',                 description_ar: 'عسل مباشرة في قرص الشهد الطبيعي – نقي وطبيعي ومركّز.' },
    { name_de: 'Wabenhonig hell (Açık Çıta)',  name_ar: 'عسل الشمع الفاتح',          description_ar: 'عسل شمع فاتح اللون من سيواس – زهري الرائحة ولطيف الطعم.' },
    { name_de: 'Kastanienhonig',               name_ar: 'عسل الكستناء',              description_ar: 'عسل الكستناء الداكن والقوي – ذو طابع مميز مع لمسة خفيفة من المرارة.' },
  ]

  const upd = db.prepare("UPDATE products SET name_ar=?, description_ar=? WHERE name_de=? AND (name_ar='' OR name_ar IS NULL)")
  db.transaction(() => { for (const p of products) upd.run(p.name_ar, p.description_ar, p.name_de) })()

  const categories = [
    { slug: 'Milchprodukte',        name_ar: 'منتجات الألبان' },
    { slug: 'Türkische Käsesorten', name_ar: 'أجبان تركية' },
    { slug: 'Backwaren',            name_ar: 'مخبوزات' },
    { slug: 'Oliven & Öl',          name_ar: 'زيتون وزيت' },
    { slug: 'Honig',                name_ar: 'عسل' },
  ]
  const updCat = db.prepare("UPDATE categories SET name_ar=? WHERE slug=? AND (name_ar='' OR name_ar IS NULL)")
  db.transaction(() => { for (const c of categories) updCat.run(c.name_ar, c.slug) })()
}

export function seedCategories() {
  const { c } = db.prepare("SELECT COUNT(*) as c FROM categories").get();
  if (c > 0) return;
  const insert = db.transaction((items) => {
    for (const item of items) queries.insertCategory.run({ name_ar: '', ...item });
  });
  insert([
    { slug: "Milchprodukte",          name_de: "Milchprodukte",         name_tr: "Süt Ürünleri",          name_en: "Dairy Products",          sort_order: 1 },
    { slug: "Türkische Käsesorten",   name_de: "Türkische Käsesorten",  name_tr: "Yöresel Peynirler",     name_en: "Turkish Cheese Varieties", sort_order: 2 },
    { slug: "Backwaren",              name_de: "Backwaren",             name_tr: "Unlu Mamüller",          name_en: "Baked Goods",             sort_order: 3 },
    { slug: "Oliven & Öl",            name_de: "Oliven & Öl",           name_tr: "Zeytin ve Yağ",         name_en: "Olives & Oil",            sort_order: 4 },
    { slug: "Honig",                  name_de: "Honig",                 name_tr: "Bal Çeşitleri",          name_en: "Honey",                   sort_order: 5 },
  ]);
  console.log("✅ 5 Kategorien geseedet");
}
