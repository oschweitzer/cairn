/**
 * Logique pure du contrôle des mots de passe compromis.
 *
 * Séparée de l'appel réseau pour la même raison que src/db/noteLogic.ts l'est
 * des requêtes : elle n'a besoin ni de React ni du réseau, donc elle se teste
 * directement sous Node — et c'est là que se cachent les erreurs qui comptent,
 * une comparaison de casse ratée laissant passer tous les mots de passe fuités.
 *
 * ── Le mot de passe ne sort jamais de l'appareil ─────────────────────────────
 * Le service ne reçoit que les cinq premiers caractères de l'empreinte SHA-1.
 * Ce préfixe est partagé par des centaines de milliers de mots de passe : il
 * désigne un seau, jamais un mot de passe. La réponse contient tous les suffixes
 * du seau, et c'est ici, hors réseau, que l'on cherche le nôtre.
 *
 * C'est le mécanisme dit de k-anonymat, et c'est exactement celui que Supabase
 * emploie derrière son interrupteur payant.
 */

/** Longueur du préfixe attendue par l'API. Cinq caractères, pas un de plus. */
const PREFIX_LENGTH = 5

export type HashParts = { prefix: string; suffix: string }

/**
 * Coupe l'empreinte en un préfixe à envoyer et un suffixe à garder.
 * Rend `null` si l'empreinte n'a pas la forme d'un SHA-1.
 */
export function splitHash(hex: string): HashParts | null {
  const value = hex.trim().toUpperCase()
  if (!/^[0-9A-F]{40}$/.test(value)) return null
  return { prefix: value.slice(0, PREFIX_LENGTH), suffix: value.slice(PREFIX_LENGTH) }
}

/**
 * Cherche le suffixe dans la réponse du service et rend le nombre de fuites
 * connues. Zéro signifie « jamais vu », ce qui est la seule bonne nouvelle.
 *
 * Chaque ligne vaut `SUFFIXE:COMPTE`. Les lignes à compte nul sont du
 * rembourrage : le service en ajoute, sur demande, pour que toutes les réponses
 * pèsent pareil et qu'un observateur du trafic ne puisse pas déduire du poids
 * combien de mots de passe partagent le préfixe. Les compter comme des trouvailles
 * refuserait tous les mots de passe.
 */
export function countInRange(body: string, suffix: string): number {
  const needle = suffix.trim().toUpperCase()
  if (needle.length === 0) return 0

  for (const line of body.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    if (line.slice(0, separator).trim().toUpperCase() !== needle) continue

    const count = Number.parseInt(line.slice(separator + 1).trim(), 10)
    return Number.isFinite(count) && count > 0 ? count : 0
  }
  return 0
}
