/**
 * Writes public/.well-known/assetlinks.json, which allows the Android app to
 * open links on the PWA's domain.
 *
 *   npm run assetlinks
 *
 * Android reads this file at install time. If it matches the certificate that
 * signed the APK, a `https://<domain>/note/<id>` link opens Cairn directly.
 * Otherwise it goes to the browser — with no message, no warning, nothing that
 * signals a wrong fingerprint. Hence this script's checks: it is the only place
 * where a mistake can still be called out.
 *
 * Two values, in .env:
 *
 *   EXPO_PUBLIC_WEB_URL   the PWA's address, whose host is already declared in
 *                         `intentFilters` by app.config.js
 *   ANDROID_CERT_SHA256   the signing certificate's fingerprint, as returned by
 *                         `eas credentials`
 *
 * The file is not written until both are there. An incomplete file served in
 * production is no better than no file at all, and looks far more like a
 * finished configuration.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sortie = join(root, 'public', '.well-known', 'assetlinks.json')

const mode = process.argv[2] ?? '--write'

/**
 * Must stay in agreement with app.config.js's `android.package`. A divergence
 * would only show in use, as a link that keeps opening the browser.
 */
const PAQUET = 'app.cairn'

// --------------------------------------------------------------------- read

/**
 * .env is not loaded by tsx, unlike what Expo does on startup. So we read it by
 * hand, with no dependency: three lines are enough, and one more dependency for
 * that alone would be poorly spent.
 */
function chargerEnv(): Record<string, string> {
  const chemin = join(root, '.env')
  if (!existsSync(chemin)) return {}
  const out: Record<string, string> = {}
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const nettoyee = ligne.trim()
    if (!nettoyee || nettoyee.startsWith('#')) continue
    const separateur = nettoyee.indexOf('=')
    if (separateur === -1) continue
    out[nettoyee.slice(0, separateur).trim()] = nettoyee
      .slice(separateur + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...chargerEnv(), ...process.env }

const urlWeb = env.EXPO_PUBLIC_WEB_URL?.trim()
const empreinte = env.ANDROID_CERT_SHA256?.trim().toUpperCase()

const manques: string[] = []
if (!urlWeb) manques.push('EXPO_PUBLIC_WEB_URL')
if (!empreinte) manques.push('ANDROID_CERT_SHA256')

if (manques.length > 0) {
  console.log(`assetlinks : rien à écrire, ${manques.join(' et ')} manque${manques.length > 1 ? 'nt' : ''} dans .env.`)
  console.log('             L’empreinte se lit avec : eas credentials  (Android, Keystore)')
  console.log('             Sans ce fichier, les liens de note ouvrent le navigateur au lieu de l’application.')
  process.exit(mode === '--check' ? 1 : 0)
}

// --------------------------------------------------------------- validation

/**
 * Thirty-two bytes in hexadecimal separated by colons, exactly the shape
 * `eas credentials` returns. Checking it here avoids the only truly silent
 * failure mode in this whole chain: a mistyped fingerprint produces a file that
 * is perfectly valid JSON, which Android rejects without a word.
 */
if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(empreinte!)) {
  console.error('assetlinks : ANDROID_CERT_SHA256 n’a pas la forme attendue.')
  console.error('             Attendu 32 octets hexadécimaux séparés par « : », par exemple')
  console.error('             A1:B2:C3:…:FF  (64 chiffres, 31 deux-points)')
  console.error(`             Reçu : ${empreinte}`)
  process.exit(1)
}

let hote: string
try {
  hote = new URL(urlWeb!).hostname
} catch {
  console.error(`assetlinks : EXPO_PUBLIC_WEB_URL n’est pas une URL valide : ${urlWeb}`)
  process.exit(1)
}

// -------------------------------------------------------------------- write

const contenu =
  JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PAQUET,
          sha256_cert_fingerprints: [empreinte],
        },
      },
    ],
    null,
    2,
  ) + '\n'

if (mode === '--check') {
  const actuel = existsSync(sortie) ? readFileSync(sortie, 'utf8') : null
  if (actuel !== contenu) {
    console.error('assetlinks : public/.well-known/assetlinks.json a dérivé de .env.')
    console.error('             Régénérer avec : npm run assetlinks')
    process.exit(1)
  }
  console.log(`assetlinks : à jour pour ${hote} (${PAQUET}).`)
  process.exit(0)
}

mkdirSync(dirname(sortie), { recursive: true })
writeFileSync(sortie, contenu)

console.log(`assetlinks : écrit pour ${hote}, paquet ${PAQUET}.`)
console.log('             Servi à /.well-known/assetlinks.json après « npm run build:web ».')
