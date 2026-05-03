import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import nunjucks from 'nunjucks'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = path.join(__dirname, '..', 'locales')
const VALID_LANGS = ['de', 'tr', 'ar']

const locales = {}
for (const lang of VALID_LANGS) {
  locales[lang] = JSON.parse(readFileSync(path.join(LOCALES_DIR, `${lang}.json`), 'utf-8'))
}

export function makeT(lang) {
  const data = locales[lang] ?? locales.de
  const fallback = locales.de
  return (key) => data[key] ?? fallback[key] ?? key
}

export function createNunjucksEnv(templatesDir) {
  const loader = new nunjucks.FileSystemLoader(templatesDir, {
    noCache: process.env.NODE_ENV !== 'production',
  })
  const env = new nunjucks.Environment(loader, { autoescape: true })

  env.addFilter('eur', (n) => `${Number(n).toFixed(2)} €`)

  const parseDate = (val) => new Date(String(val).replace(' ', 'T') + 'Z')

  env.addFilter('dateDE', (val) => {
    if (!val) return ''
    return parseDate(val).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
  })
  env.addFilter('datetimeDE', (val) => {
    if (!val) return ''
    return parseDate(val).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  })
  env.addFilter('timeDE', (val) => {
    if (!val) return ''
    return parseDate(val).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  })

  return env
}
