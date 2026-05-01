# Haksüt34 Bestellsystem

Produktionsreifes Bestellsystem für Haksüt34 – frische Büffel- und Ziegenprodukte aus Holland und Anatolien, geliefert innerhalb Deutschlands.

## Stack

- **Backend**: Node.js ≥ 22 + Fastify
- **Datenbank**: SQLite (persistent über Docker Volume)
- **Frontend**: Nunjucks + Vanilla JS + Custom CSS
- **E-Mail**: SMTP via Nodemailer
- **Deployment**: Docker Compose + Traefik (automatisches TLS via Let's Encrypt)
- **Sprachen**: Deutsch 🇩🇪, Türkisch 🇹🇷, Englisch 🇬🇧

---

## Schnellstart

### 1. Konfiguration

```bash
cp .env.example .env
```

`.env` befüllen:

```env
DOMAIN=bestellungen.haksut34.de
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=info@haksut34.de
SMTP_PASSWORD=dein-app-passwort
SMTP_FROM_NAME=Haksüt34
ADMIN_EMAIL=admin@haksut34.de
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SicheresPasswort123!
SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

### 2. Starten

```bash
docker compose up -d
```

Der erste Start:

- Erstellt die SQLite-Datenbank automatisch
- Legt den Admin-User aus `ADMIN_USERNAME`/`ADMIN_PASSWORD` an
- Befüllt die Datenbank mit 39 Produkten (Milch, Käse, Backwaren, Oliven, Honig)

### 3. Admin-Zugang

→ `https://DOMAIN/admin/login`

Benutzername und Passwort wie in `.env` konfiguriert.

---

## Lokale Entwicklung (ohne Docker)

```bash
cd app
npm install

# Umgebungsvariablen setzen
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=test123
export DATABASE_PATH=./data/haksut34.db

# Starten (mit Auto-Reload)
npm run dev
```

Shop → http://localhost:8000  
Admin → http://localhost:8000/admin/login

---

## SMTP (Gmail)

1. Gmail → Einstellungen → Sicherheit → App-Passwörter
2. Neues App-Passwort für „Mail" erstellen
3. In `.env` als `SMTP_PASSWORD` eintragen

Ohne SMTP-Konfiguration werden E-Mails übersprungen (nur Warnung im Log).

---

## URLs

| URL                                       | Beschreibung                       |
| ----------------------------------------- | ---------------------------------- |
| `/`                                       | Shop-Startseite                    |
| `/warenkorb`                              | Warenkorb + Bestellformular        |
| `/bestellung/erfolg/{nr}`                 | Bestellbestätigung                 |
| `/bestellung/suchen`                      | Bestellung per Nr. + E-Mail suchen |
| `/bestellung/aendern?token=…`             | Bestellung bearbeiten/stornieren   |
| `/admin/login`                            | Admin-Login                        |
| `/admin/dashboard`                        | Admin-Dashboard                    |
| `/admin/bestellungen`                     | Bestellliste mit Filtern           |
| `/admin/produkte`                         | Produkt-CRUD                       |
| `/sprache/de` `/sprache/tr` `/sprache/en` | Sprache wechseln                   |

---

## Bestellstatus-Ablauf

```
pending → confirmed → locked → delivered
                    ↘ cancelled
```

- **pending**: Neu eingegangen, Kunde kann noch ändern
- **confirmed**: Admin hat bestätigt
- **locked**: Gesperrt, keine Kundenänderungen mehr möglich
- **delivered**: Abgeliefert/übergeben
- **cancelled**: Storniert

---

## Persistenz

Zwei Docker Volumes halten die Daten dauerhaft:

| Volume           | Inhalt                                    |
| ---------------- | ----------------------------------------- |
| `db_data`        | SQLite-Datenbank (`/data/haksut34.db`)    |
| `product_images` | Hochgeladene Produktbilder                |

---

## Sicherheit

- Passwörter mit bcryptjs gehasht
- Session-Token als signiertes Cookie (Fastify)
- Rate Limiting: max 5 Bestellungen pro IP/Stunde
- Bildupload: nur JPG/PNG/WEBP, max 5 MB
- SQL-Injection-Schutz durch Prepared Statements (better-sqlite3)
- DSGVO-Checkbox bei Bestellung

---

## Produkte

39 Produkte in 5 Kategorien werden beim ersten Start automatisch geseedet:

| Kategorie              | Anzahl |
| ---------------------- | ------ |
| Milchprodukte          | 10     |
| Türkische Käsesorten   | 17     |
| Backwaren              | 4      |
| Oliven & Öl            | 4      |
| Honig                  | 4      |

Produkte können jederzeit über `/admin/produkte` verwaltet werden.

---

## Bestellnummer-Format

`HS34-YYYY-XXXXXX` – z.B. `HS34-2025-AB4C7Z`
