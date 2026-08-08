/**
 * Écrit public/.well-known/assetlinks.json, qui autorise l'application Android
 * à ouvrir les liens du domaine de la PWA.
 *
 *   npm run assetlinks
 *
 * Android lit ce fichier à l'installation. S'il concorde avec le certificat qui
 * a signé l'APK, un lien `https://<domaine>/note/<id>` ouvre Cairn directement.
 * Sinon il part au navigateur — sans message, sans avertissement, sans rien qui
 * signale une empreinte erronée. D'où les vérifications de ce script : c'est le
 * seul endroit où une faute peut encore être dite.
 *
 * Deux valeurs, dans .env :
 *
 *   EXPO_PUBLIC_WEB_URL   l'adresse de la PWA, dont l'hôte est déjà déclaré en
 *                         `intentFilters` par app.config.js
 *   ANDROID_CERT_SHA256   l'empreinte du certificat de signature, rendue par
 *                         `eas credentials`
 *
 * Le fichier n'est pas écrit tant que les deux ne sont pas là. Un fichier
 * incomplet servi en production ne vaut pas mieux qu'aucun fichier, et ressemble
 * bien davantage à une configuration terminée.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sortie = join(root, 'public', '.well-known', 'assetlinks.json')

const mode = process.argv[2] ?? '--write'

/**
 * Doit rester d'accord avec `android.package` d'app.config.js. Une divergence
 * ne se verrait qu'à l'usage, par un lien qui s'obstine à ouvrir le navigateur.
 */
const PAQUET = 'app.cairn'

// ------------------------------------------------------------------ lecture

/**
 * .env n'est pas chargé par tsx, contrairement à ce que fait Expo au démarrage.
 * On le lit donc à la main, sans dépendance : trois lignes suffisent, et une
 * dépendance de plus pour cela seul serait mal employée.
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
 * Trente-deux octets en hexadécimal séparés par des deux-points, soit
 * exactement la forme que rend `eas credentials`. La vérifier ici évite le seul
 * mode de panne réellement silencieux de toute cette chaîne : une empreinte
 * recopiée de travers produit un fichier parfaitement valide au regard du JSON,
 * qu'Android rejette sans un mot.
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

// ------------------------------------------------------------------ écriture

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
