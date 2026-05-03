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
    for (const p of items) queries.insertProduct.run({ name_en: "", description_en: "", ...p });
  });

  insert([
    // ── Milchprodukte (Hollanda) ───────────────────────────────────────────
    {
      name_de: "Büffelmilch",
      name_tr: "Manda Sütü",
      name_ar: "حليب الجاموس",
      description_de:
        "Frische Büffelmilch aus Holland – besonders cremig und nährstoffreich.",
      description_tr:
        "Hollanda'dan taze manda sütü – özellikle kremsi ve besin değeri yüksek.",
      description_ar: "حليب جاموس طازج من هولندا – كريمي بشكل استثنائي وغني بالمغذيات.",
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
      name_ar: "زبادي الجاموس",
      description_de:
        "Dickrahmiger Büffeljoghurt – natürlich und ohne Zusatzstoffe.",
      description_tr: "Yoğun kremali manda yoğurdu – doğal ve katkısız.",
      description_ar: "زبادي الجاموس كثيف القشدة – طبيعي وخالٍ من المضافات.",
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
      name_ar: "قشدة الجاموس (قيمق)",
      description_de:
        "Samtig-dicker Büffelrahm – traditionell zu Honig und frischem Brot.",
      description_tr:
        "Kadifemsi manda kaymağı – geleneksel olarak bal ve taze ekmekle.",
      description_ar: "قشدة جاموس ناعمة وكثيفة – تُقدَّم تقليدياً مع العسل والخبز الطازج.",
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
      name_ar: "جبن جاموس طازج",
      description_de:
        "Weicher, frischer Weißkäse aus Büffelmilch – mild und aromatisch.",
      description_tr:
        "Büffel sütünden yumuşak taze beyaz peynir – hafif ve aromatik.",
      description_ar: "جبن أبيض طري وطازج من حليب الجاموس – خفيف الطعم وعطري.",
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
      name_ar: "جبن لور الجاموس",
      description_de:
        "Frischer Lor-Käse aus Büffelmilch – leicht, cremig, ideal zum Frühstück.",
      description_tr:
        "Manda sütünden taze lor peyniri – hafif, kremsi, kahvaltı için ideal.",
      description_ar: "جبن لور طازج من حليب الجاموس – خفيف وكريمي، مثالي لوجبة الفطور.",
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
      name_ar: "حليب الماعز",
      description_de:
        "Frische Ziegenmilch aus Holland – leicht verdaulich und nährstoffreich.",
      description_tr:
        "Hollanda'dan taze keçi sütü – kolay sindirilebilir ve besleyici.",
      description_ar: "حليب ماعز طازج من هولندا – سهل الهضم وغني بالمغذيات.",
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
      name_ar: "زبادي الماعز",
      description_de: "Naturjoghurt aus Ziegenmilch – leicht und bekömmlich.",
      description_tr: "Keçi sütünden sade yoğurt – hafif ve sindirimi kolay.",
      description_ar: "زبادي طبيعي من حليب الماعز – خفيف وسهل الهضم.",
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
      name_ar: "جبن كاشار الماعز",
      description_de:
        "Halbharter Kaşar-Käse aus Ziegenmilch – würzig und schmelzend.",
      description_tr:
        "Keçi sütünden yarı sert kaşar peyniri – lezzetli ve eriyebilir.",
      description_ar: "جبن كاشار نصف صلب من حليب الماعز – حار الطعم وينذاب بسهولة.",
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
      name_ar: "جبن أبيض من الماعز",
      description_de:
        "Klassischer weißer Käse aus Ziegenmilch – fein-salzig und cremig.",
      description_tr:
        "Keçi sütünden klasik beyaz peynir – hafif tuzlu ve kremsi.",
      description_ar: "جبن أبيض كلاسيكي من حليب الماعز – خفيف المذاق المالح وكريمي.",
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
      name_ar: "جبن ماعز طازج",
      description_de:
        "Kleiner frischer Ziegenkäse – zart und vielseitig einsetzbar.",
      description_tr:
        "Küçük taze keçi peyniri – narin ve çok yönlü kullanımlı.",
      description_ar: "جبن ماعز طازج صغير – ناعم ومتعدد الاستخدامات.",
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
      name_ar: "زبدة البحر الأسود",
      description_de:
        "Traditionelle Butterspezialität aus der Schwarzmeerregion – intensiv im Geschmack.",
      description_tr:
        "Karadeniz yöresine özgü geleneksel tereyağı – yoğun aromalı.",
      description_ar: "زبدة تقليدية مميزة من منطقة البحر الأسود – غنية النكهة بشكل استثنائي.",
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
      name_ar: "جبن قرية يوروك (طازج)",
      description_de:
        "Frischer Weißkäse nach Nomaden-Art – handgemacht aus Rohmilch.",
      description_tr: "Yörük usulü taze köy peyniri – çiğ sütten el yapımı.",
      description_ar: "جبن أبيض طازج على طريقة الرحّالة – مصنوع يدوياً من حليب خام.",
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
      name_ar: "جبن القرية بالأعشاب",
      description_de:
        "Frischer Dorfkäse mit aromatischen Bergkräutern – typisch ostanatolisch.",
      description_tr:
        "Dağ otları ile aromalı taze köy peyniri – tipik Doğu Anadolu lezzeti.",
      description_ar: "جبن قرية طازج بالأعشاب الجبلية العطرية – نموذجي لشرق الأناضول.",
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
      name_ar: "جبن كويماك (جبن ذائب)",
      description_de:
        "Weicher Käse ideal zum Schmelzen – perfekt für traditionelles Kuymak-Gericht.",
      description_tr:
        "Kuymak yapmak için ideal yumuşak peynir – geleneksel lezzet.",
      description_ar: "جبن طري مثالي للإذابة – مثالي لطبق الكويماك التقليدي.",
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
      name_ar: "جبن الخيوط مع جوكيليك",
      description_de:
        "Gezogener Fadenkäse mit Çökelek-Füllung – handwerklich hergestellt.",
      description_tr: "Çökelek dolgulu el yapımı tel peyniri.",
      description_ar: "جبن خيوط ممتد محشو بجوكيليك – مصنوع بطريقة حرفية يدوية.",
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
      name_ar: "جبن مضفور",
      description_de:
        "Geflochtener Käse nach türkischer Tradition – zart und faserig.",
      description_tr: "Geleneksel Türk usulü örgü peyniri – narin ve lifli.",
      description_ar: "جبن مضفور على الطريقة التركية التقليدية – ناعم وليفي.",
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
      name_ar: "جبن الدل (جبن اللسان)",
      description_de:
        "Milder, faserig-weicher Käse – ideal als Snack oder zum Frühstück.",
      description_tr:
        "Hafif, lifli ve yumuşak peynir – atıştırmalık veya kahvaltı için ideal.",
      description_ar: "جبن خفيف وليفي وطري – مثالي كوجبة خفيفة أو لوجبة الفطور.",
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
      name_ar: "جبن تولوم في بيدون",
      description_de:
        "Gereifter Tulum-Käse im Kanister – kräftig, würzig, charaktervoll.",
      description_tr:
        "Bidon içinde olgunlaştırılmış tulum peyniri – güçlü ve baharatlı.",
      description_ar: "جبن تولوم مُعتَّق في وعاء معدني – قوي الطعم وعطري ومميز.",
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
      name_ar: "جبن سيسيل خيوط 800 غرام",
      description_de:
        "Armenisch-türkischer Cecil-Käse – faserig, mild und aromatisch.",
      description_tr: "Ermeni-Türk Cecil peyniri – lifli, hafif ve aromatik.",
      description_ar: "جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.",
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
      name_ar: "جبن سيسيل خيوط 400 غرام",
      description_de:
        "Armenisch-türkischer Cecil-Käse – faserig, mild und aromatisch.",
      description_tr: "Ermeni-Türk Cecil peyniri – lifli, hafif ve aromatik.",
      description_ar: "جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.",
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
      name_ar: "زبدة",
      description_de: "Naturbelassene Butter – cremig und vollmundig.",
      description_tr: "Doğal sade tereyağı – kremsi ve dolgun aromalı.",
      description_ar: "زبدة طبيعية – كريمية وغنية المذاق.",
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
      name_ar: "جبن أزين",
      description_de:
        "Legendärer Weißkäse aus Ezine – g.U.-geschützt, vollmundig und salzig.",
      description_tr:
        "Efsanevi Ezine peyniri – coğrafi işaretli, dolgun ve tuzlu.",
      description_ar: "جبن أبيض أسطوري من أزين – محمي بمؤشر جغرافي، غني المذاق ومالح.",
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
      name_ar: "جبن السلة (سيبت)",
      description_de:
        "Im Weidenkorb gereifter Weißkäse – feine Korbstruktur, würzig-salzig.",
      description_tr:
        "Hasır sepette olgunlaştırılmış beyaz peynir – ince sepet dokusu, baharatlı-tuzlu.",
      description_ar: "جبن أبيض مُعتَّق في سلة صفصاف – بنية سلة دقيقة، عطري ومالح.",
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
      name_ar: "كاشار كارس المُعتَّق",
      description_de:
        "Traditionell gereifter Kaşar-Käse aus Kars – intensiv, nussig, unverwechselbar.",
      description_tr:
        "Kars'tan geleneksel olgunlaştırılmış kaşar – yoğun, fındıksı, eşsiz.",
      description_ar: "جبن كاشار مُعتَّق تقليدياً من كارس – مكثف ومذاق جوزي لا يُضاهى.",
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
      name_ar: "جبن أعشاب فان",
      description_de:
        "Weißkäse aus Van mit aromatischen Wildkräutern – frühlingshaft und würzig.",
      description_tr:
        "Van yöresine özgü yabani otlu beyaz peynir – bahar aromalı ve baharatlı.",
      description_ar: "جبن أبيض من فان بأعشاب برية عطرية – ربيعي الطعم وحار.",
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
      name_ar: "جبن تولوم أرزينجان",
      description_de:
        "Gereifter Tulum-Käse aus Erzincan – kräftig aromatisch und leicht krümelig.",
      description_tr:
        "Erzincan tulum peyniri – kuvvetli aromalı ve hafif ufalanan.",
      description_ar: "جبن تولوم مُعتَّق من أرزينجان – قوي العطر وهش قليلاً.",
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
      name_ar: "جبن تولوم بالحبة السوداء",
      description_de:
        "Kuhmilch-Tulum-Käse mit Schwarzkümmel – aromatisch und charaktervoll.",
      description_tr:
        "Çörekotlu inek sütü tulum peyniri – aromatik ve karakterli.",
      description_ar: "جبن تولوم بالحبة السوداء – عطري ومميز الطعم.",
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
      name_ar: "بورك الماء (دائري)",
      description_de:
        "Hausgemachter Wasserbörek in runder Form – knusprig außen, saftig innen.",
      description_tr: "Ev yapımı yuvarlak su böreği – dışı çıtır, içi sulu.",
      description_ar: "بورك الماء محلي الصنع بشكل دائري – مقرمش من الخارج وطري من الداخل.",
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
      name_ar: "بورك الماء (مستطيل)",
      description_de:
        "Hausgemachter Wasserbörek in rechteckiger Form – klassisch und saftig.",
      description_tr: "Ev yapımı dörtgen su böreği – klasik ve sulu.",
      description_ar: "بورك الماء محلي الصنع بشكل مستطيل – كلاسيكي وطري.",
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
      name_ar: 'مانتي باللحم المفروم',
      description_de:
        'Türkische Teigtaschen mit Hackfleisch „Tuna" – servierbereit, einzufrieren.',
      description_tr: '„Tuna" kıymalı Türk mantısı – hazır, dondurucuya uygun.',
      description_ar: 'مانتي تركي صغير محشو باللحم المفروم – يُقدَّم مع الزبادي والزبدة.',
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
      name_ar: "يوفكا قروي طازج (عبوة 5 قطع)",
      description_de:
        "Hauchdünnes Yufka-Fladenbrot aus dem Dorf – frisch und flexibel.",
      description_tr: "Köyden taze, ince köy yufkası – taze ve esnek.",
      description_ar: "يوفكا قروي طازج رفيع – مناسب لمختلف الوصفات التركية.",
      price: 6.5,
      unit: "5er-Pack",
      category: "Backwaren",
      image_url: IMG.yufka,
      is_active: 1,
      stock: null,
    },

    // ── Oliven & Öl ───────────────────────────────────────────────────────
    {
      name_de: "Kaltgepresstes Olivenöl",
      name_tr: "Soğuk Sıkım Zeytinyağı",
      name_ar: "زيت زيتون بكر ممتاز",
      description_de:
        "Natives Olivenöl extra – direkt kaltgepresst, fruchtig und aromatisch.",
      description_tr: "Soğuk sıkım sızma zeytinyağı – meyveli ve aromatik.",
      description_ar: "زيت زيتون بكر ممتاز معصور بالبرد – ذهبي مخضر وعطري.",
      price: 65.0,
      unit: "5 Liter",
      category: "Oliven & Öl",
      image_url: IMG.olive_oil,
      is_active: 1,
      stock: null,
    },
    {
      name_de: "Kaltgepresstes Olivenöl",
      name_tr: "Soğuk Sıkım Zeytinyağı",
      name_ar: "زيت زيتون بكر ممتاز",
      description_de:
        "Natives Olivenöl extra in der Flasche – direkt kaltgepresst, fruchtig und aromatisch.",
      description_tr:
        "Şişede soğuk sıkım sızma zeytinyağı – meyveli ve aromatik.",
      description_ar: "زيت زيتون بكر ممتاز معصور بالبرد – ذهبي مخضر وعطري.",
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
      name_ar: "زيتون مشكل (أسود وأخضر)",
      description_de:
        "Sortiment schwarzer und grüner Oliven – würzig mariniert, typisch mediterran.",
      description_tr:
        "Siyah ve yeşil zeytin karışımı – baharatlı marine, tipik Akdeniz lezzeti.",
      description_ar: "مزيج من الزيتون الأسود والأخضر – وجبة خفيفة مثالية.",
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
      name_ar: "دلو زيتون (أسود وأخضر)",
      description_de:
        "Großer Eimer gemischter Oliven – für die ganze Familie oder den Vorrat.",
      description_tr:
        "Büyük kova karışık zeytin – tüm aile için veya stok amaçlı.",
      description_ar: "كمية كبيرة من الزيتون المشكل للعائلات والمطاعم.",
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
      name_ar: "عسل كاراكوفان البري",
      description_de:
        "Ursprünglicher Blockhöhlen-Honig aus der Region Sivas – roh, ungefiltert, intensiv.",
      description_tr:
        "Sivas yöresinden ham, süzülmemiş karakovan balı – yoğun aromalı.",
      description_ar: "عسل بري نادر من خلايا كاراكوفان – غني بالمغذيات وعطري جداً.",
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
      name_ar: "عسل الشمع الداكن",
      description_de:
        "Dunkler Wabenhonig aus Sivas – kräftig aromatisch, essbar mit Wabe.",
      description_tr:
        "Sivas'tan koyu renkli petek çıta bal – kuvvetli aromalı, peteğiyle yenebilir.",
      description_ar: "عسل شمع داكن اللون وقوي المذاق – طبيعي 100% مع قرص الشهد.",
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
      name_ar: "عسل الشمع الفاتح",
      description_de:
        "Heller, milder Wabenhonig aus Sivas – floral, fein, mit essbarer Wabe.",
      description_tr:
        "Sivas'tan açık renkli çıta bal – çiçeksi, ince aromalı, peteğiyle.",
      description_ar: "عسل شمع فاتح اللون من سيواس – زهري الرائحة ولطيف الطعم.",
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
      name_ar: "عسل الكستناء",
      description_de:
        "Intensiver Kastanienhonig aus der Region Sivas – dunkel, leicht bitter, charaktervoll.",
      description_tr:
        "Sivas yöresinden yoğun kestane balı – koyu, hafif acı, karakterli.",
      description_ar: "عسل الكستناء الداكن والقوي – ذو طابع مميز مع لمسة خفيفة من المرارة.",
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

// Migration for existing databases: fills Arabic names and renames changed products
export function migrateArabicNames() {
  // Rename olive oil products that had size suffix removed
  db.prepare("UPDATE products SET name_de='Kaltgepresstes Olivenöl', name_tr='Soğuk Sıkım Zeytinyağı' WHERE name_de IN ('Kaltgepresstes Olivenöl 5 L', 'Kaltgepresstes Olivenöl 1 L')").run();

  const upd = db.prepare("UPDATE products SET name_ar=?, description_ar=? WHERE name_de=? AND (name_ar='' OR name_ar IS NULL)");
  const pairs = [
    ['حليب الجاموس','حليب جاموس طازج من هولندا – كريمي بشكل استثنائي وغني بالمغذيات.','Büffelmilch'],
    ['زبادي الجاموس','زبادي الجاموس كثيف القشدة – طبيعي وخالٍ من المضافات.','Büffeljoghurt'],
    ['قشدة الجاموس (قيمق)','قشدة جاموس ناعمة وكثيفة – تُقدَّم تقليدياً مع العسل والخبز الطازج.','Büffelrahm (Kaymak)'],
    ['جبن جاموس طازج','جبن أبيض طري وطازج من حليب الجاموس – خفيف الطعم وعطري.','Frischer Büffelkäse'],
    ['جبن لور الجاموس','جبن لور طازج من حليب الجاموس – خفيف وكريمي، مثالي لوجبة الفطور.','Büffel-Lor-Käse'],
    ['حليب الماعز','حليب ماعز طازج من هولندا – سهل الهضم وغني بالمغذيات.','Ziegenmilch'],
    ['زبادي الماعز','زبادي طبيعي من حليب الماعز – خفيف وسهل الهضم.','Ziegenjoghurt'],
    ['جبن كاشار الماعز','جبن كاشار نصف صلب من حليب الماعز – حار الطعم وينذاب بسهولة.','Ziegen-Kaşar-Käse'],
    ['جبن أبيض من الماعز','جبن أبيض كلاسيكي من حليب الماعز – خفيف المذاق المالح وكريمي.','Weißer Ziegenkäse'],
    ['جبن ماعز طازج','جبن ماعز طازج صغير – ناعم ومتعدد الاستخدامات.','Frischer Ziegenkäse'],
    ['زبدة البحر الأسود','زبدة تقليدية مميزة من منطقة البحر الأسود – غنية النكهة بشكل استثنائي.','Schwarzmeer-Butter (Karadeniz)'],
    ['جبن قرية يوروك (طازج)','جبن أبيض طازج على طريقة الرحّالة – مصنوع يدوياً من حليب خام.','Yörük-Dorfkäse (frisch)'],
    ['جبن القرية بالأعشاب','جبن قرية طازج بالأعشاب الجبلية العطرية – نموذجي لشرق الأناضول.','Kräuter-Dorfkäse (Otlu)'],
    ['جبن كويماك (جبن ذائب)','جبن طري مثالي للإذابة – مثالي لطبق الكويماك التقليدي.','Kuymak-Käse (Schmelzkäse)'],
    ['جبن الخيوط مع جوكيليك','جبن خيوط ممتد محشو بجوكيليك – مصنوع بطريقة حرفية يدوية.','Fadenkäse mit Çökelek'],
    ['جبن مضفور','جبن مضفور على الطريقة التركية التقليدية – ناعم وليفي.','Örgü-Käse (geflochten)'],
    ['جبن الدل (جبن اللسان)','جبن خفيف وليفي وطري – مثالي كوجبة خفيفة أو لوجبة الفطور.','Dil-Käse (Zungenkäse)'],
    ['جبن تولوم في بيدون','جبن تولوم مُعتَّق في وعاء معدني – قوي الطعم وعطري ومميز.','Bidon-Tulum-Käse'],
    ['جبن سيسيل خيوط 800 غرام','جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.','Cecil-Fadenkäse 800g'],
    ['جبن سيسيل خيوط 400 غرام','جبن سيسيل أرمني-تركي – ليفي وخفيف وعطري.','Cecil-Fadenkäse 400g'],
    ['زبدة','زبدة طبيعية – كريمية وغنية المذاق.','Butter'],
    ['جبن أزين','جبن أبيض أسطوري من أزين – محمي بمؤشر جغرافي، غني المذاق ومالح.','Ezine-Käse'],
    ['جبن السلة (سيبت)','جبن أبيض مُعتَّق في سلة صفصاف – بنية سلة دقيقة، عطري ومالح.','Korbkäse (Sepet)'],
    ['كاشار كارس المُعتَّق','جبن كاشار مُعتَّق تقليدياً من كارس – مكثف ومذاق جوزي لا يُضاهى.','Gereifter Kars-Kaşar'],
    ['جبن أعشاب فان','جبن أبيض من فان بأعشاب برية عطرية – ربيعي الطعم وحار.','Van-Kräuterkäse (Otlu)'],
    ['جبن تولوم أرزينجان','جبن تولوم مُعتَّق من أرزينجان – قوي العطر وهش قليلاً.','Erzincan-Tulum-Käse'],
    ['جبن تولوم بالحبة السوداء','جبن تولوم بالحبة السوداء – عطري ومميز الطعم.','Schwarzkümmel-Tulum-Käse'],
    ['بورك الماء (دائري)','بورك الماء محلي الصنع بشكل دائري – مقرمش من الخارج وطري من الداخل.','Wasserbörek rund'],
    ['بورك الماء (مستطيل)','بورك الماء محلي الصنع بشكل مستطيل – كلاسيكي وطري.','Wasserbörek eckig'],
    ['يوفكا قروي طازج (عبوة 5 قطع)','يوفكا قروي طازج رفيع – مناسب لمختلف الوصفات التركية.','Frisches Dorfyufka (5er-Pack)'],
    ['مانتي باللحم المفروم','مانتي تركي صغير محشو باللحم المفروم – يُقدَّم مع الزبادي والزبدة.','Hackfleisch-Manti „Tuna"'],
    ['زيت زيتون بكر ممتاز','زيت زيتون بكر ممتاز معصور بالبرد – ذهبي مخضر وعطري.','Kaltgepresstes Olivenöl'],
    ['زيتون أسود (جمليك)','زيتون أسود مُعتَّق طبيعياً من جمليك – خفيف الطعم ولحمي.','Schwarze Oliven (Gemlik)'],
    ['زيتون أخضر (شيزيك)','زيتون أخضر مشقوق بالثوم والأعشاب – حار ومقرمش.','Grüne Oliven (Çizik)'],
    ['زيتون مشكل (أسود وأخضر)','مزيج من الزيتون الأسود والأخضر – وجبة خفيفة مثالية.','Gemischte Oliven (Schwarz & Grün)'],
    ['دلو زيتون (أسود وأخضر)','كمية كبيرة من الزيتون المشكل للعائلات والمطاعم.','Oliven-Eimer (Schwarz & Grün)'],
    ['عسل خام طبيعي','عسل بري غير معالج من جبال الأناضول – خام وطبيعي وعطري.','Rohhonig (Naturhonig)'],
    ['عسل كاراكوفان البري','عسل بري نادر من خلايا كاراكوفان – غني بالمغذيات وعطري جداً.','Karakovan-Wildhonig'],
    ['عسل الشمع','عسل مباشرة في قرص الشهد الطبيعي – نقي وطبيعي ومركّز.','Wabenhonig'],
    ['عسل الشمع الفاتح','عسل شمع فاتح اللون من سيواس – زهري الرائحة ولطيف الطعم.','Wabenhonig hell (Açık Çıta)'],
    ['عسل الشمع الداكن','عسل شمع داكن اللون وقوي المذاق – طبيعي 100% مع قرص الشهد.','Wabenhonig dunkel (Petek Çıta)'],
    ['عسل الكستناء','عسل الكستناء الداكن والقوي – ذو طابع مميز مع لمسة خفيفة من المرارة.','Kastanienhonig'],
  ];
  db.transaction(() => { for (const [name_ar, description_ar, name_de] of pairs) upd.run(name_ar, description_ar, name_de) })();

  const updCat = db.prepare("UPDATE categories SET name_ar=? WHERE slug=? AND (name_ar='' OR name_ar IS NULL)");
  db.transaction(() => {
    updCat.run('منتجات الألبان', 'Milchprodukte');
    updCat.run('أجبان تركية',    'Türkische Käsesorten');
    updCat.run('مخبوزات',        'Backwaren');
    updCat.run('زيتون وزيت',     'Oliven & Öl');
    updCat.run('عسل',            'Honig');
  })();
}

export function seedCategories() {
  const { c } = db.prepare("SELECT COUNT(*) as c FROM categories").get();
  if (c > 0) return;
  const insert = db.transaction((items) => {
    for (const item of items) queries.insertCategory.run({ name_ar: '', ...item });
  });
  insert([
    { slug: "Milchprodukte",          name_de: "Milchprodukte",         name_tr: "Süt Ürünleri",          name_ar: "منتجات الألبان", sort_order: 1 },
    { slug: "Türkische Käsesorten",   name_de: "Türkische Käsesorten",  name_tr: "Yöresel Peynirler",     name_ar: "أجبان تركية",    sort_order: 2 },
    { slug: "Backwaren",              name_de: "Backwaren",             name_tr: "Unlu Mamüller",          name_ar: "مخبوزات",        sort_order: 3 },
    { slug: "Oliven & Öl",            name_de: "Oliven & Öl",           name_tr: "Zeytin ve Yağ",         name_ar: "زيتون وزيت",     sort_order: 4 },
    { slug: "Honig",                  name_de: "Honig",                 name_tr: "Bal Çeşitleri",          name_ar: "عسل",            sort_order: 5 },
  ]);
  console.log("✅ 5 Kategorien geseedet");
}
