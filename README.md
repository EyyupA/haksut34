# Haksüt34 Bestellsystem

Produktionsreifes Bestellsystem für Haksüt34 – frische Büffelprodukte aus Anatolien, geliefert innerhalb Deutschlands.

## Stack

- **Backend**: Python 3.12 + FastAPI
- **Datenbank**: SQLite (persistent über Docker Volume)
- **Frontend**: Jinja2 + Vanilla JS + TailwindCSS CDN
- **E-Mail**: SMTP via smtplib
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
ACME_EMAIL=info@haksut34.de
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=info@haksut34.de
SMTP_PASSWORD=dein-app-passwort
ADMIN_EMAIL=admin@haksut34.de
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SicheresPasswort123!
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
```

### 2. Starten

```bash
docker compose up -d
```

Der erste Start:
- Erstellt die SQLite-Datenbank automatisch
- Legt den Admin-User aus `ADMIN_USERNAME`/`ADMIN_PASSWORD` an
- Befüllt die Datenbank mit 6 Beispielprodukten

### 3. Admin-Zugang

→ `https://DOMAIN/admin/login`

Benutzername und Passwort wie in `.env` konfiguriert.

---

## Lokale Entwicklung (ohne Docker)

```bash
cd app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Umgebungsvariablen setzen
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=test123
export DATABASE_URL=sqlite:///./data/haksut34.db

mkdir -p data static/img/products

# Starten
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Shop → http://localhost:8000
Admin → http://localhost:8000/admin/

---

## Produkte seeden (manuell)

```bash
cd app
python3 seed.py
```

---

## SMTP (Gmail)

1. Gmail → Einstellungen → Sicherheit → App-Passwörter
2. Neues App-Passwort für „Mail" erstellen
3. In `.env` als `SMTP_PASSWORD` eintragen

Ohne SMTP-Konfiguration werden E-Mails übersprungen (nur Warnung im Log).

---

## URLs

| URL | Beschreibung |
|-----|-------------|
| `/` | Shop-Startseite |
| `/warenkorb` | Warenkorb + Bestellformular |
| `/bestellung/erfolg/{nr}` | Bestellbestätigung |
| `/bestellung/suchen` | Bestellung per Nr. + E-Mail suchen |
| `/bestellung/aendern?token=…` | Bestellung bearbeiten/stornieren |
| `/admin/` | Admin-Dashboard |
| `/admin/bestellungen` | Bestellliste mit Filtern |
| `/admin/produkte` | Produkt-CRUD |
| `/sprache/de` `/sprache/tr` `/sprache/en` | Sprache wechseln |

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

| Volume | Inhalt |
|--------|--------|
| `db_data` | SQLite-Datenbank (`/data/haksut34.db`) |
| `product_images` | Hochgeladene Produktbilder |

---

## Sicherheit

- Passwörter mit bcrypt gehasht
- Session-Token HMAC-signiert (SHA-256)
- Rate Limiting: max 5 Bestellungen pro IP/Stunde
- Bildupload: nur JPG/PNG/WEBP, max 5 MB
- SQL-Injection-Schutz durch SQLAlchemy ORM
- DSGVO-Checkbox bei Bestellung

---

## Bestellnummer-Format

`HS34-YYYY-XXXXXX` – z.B. `HS34-2025-AB4C7Z`