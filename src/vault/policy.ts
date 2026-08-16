/**
 * Règles du coffre qui ne dépendent ni de la plateforme, ni du stockage, ni de
 * la cryptographie.
 *
 * Séparé de secret.ts pour la même raison que noteLogic.ts est séparé des
 * hooks : ces fonctions décident si une saisie passe, combien de temps il faut
 * attendre après un échec, et à partir de quand une temporisation court. Ce sont
 * exactement les endroits où une erreur enfermerait quelqu'un hors de ses notes,
 * ou au contraire laisserait le coffre grand ouvert. Elles se testent donc
 * directement sous Node, sans simuler expo-secure-store.
 *
 * Ce fichier ne doit importer aucun module react-native ni expo.
 */

/** Longueur minimale. Quatre chiffres, comme un code de carte. */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 12

export type VaultSecret = {
  /** Aléatoire, en hexadécimal. Empêche deux codes identiques d'avoir la même empreinte. */
  salt: string
  hash: string
  /** Échecs consécutifs. Remis à zéro par une saisie correcte. */
  failures: number
  /** Horodatage en millisecondes jusqu'auquel toute saisie est refusée. */
  lockedUntil: number | null
  /** L'utilisateur accepte le déverrouillage biométrique. Sans effet sur le web. */
  biometrics: boolean
}

/**
 * Attente imposée après des échecs consécutifs, en millisecondes.
 *
 * Les trois premiers essais sont gratuits : se tromper de doigt arrive, et punir
 * la première erreur ne ferait qu'agacer le propriétaire du téléphone. Au-delà,
 * l'attente double à chaque échec et plafonne à cinq minutes, ce qui rend un
 * balayage manuel du clavier fastidieux bien avant d'être fructueux.
 *
 * Le plafond n'est pas une faiblesse concédée, c'est la contrepartie du fait
 * que la seule personne réellement gênée par une attente qui grandit sans fin
 * est celle qui a le droit d'entrer et qui s'est trompée.
 *
 * Cette temporisation vit à côté du secret, donc quelqu'un qui sait effacer le
 * stockage la contourne. Il perdrait aussi le coffre en le faisant, ce qui
 * suffit pour la menace visée. Elle n'a jamais eu vocation à arrêter un analyste.
 */
export const FREE_ATTEMPTS = 3
const BASE_DELAY_MS = 15_000
const MAX_DELAY_MS = 5 * 60_000

export function delayForFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0
  const step = failures - FREE_ATTEMPTS - 1
  return Math.min(BASE_DELAY_MS * 2 ** step, MAX_DELAY_MS)
}

/**
 * Fermeture automatique : cinq minutes sans un geste.
 *
 * Le seuil vit ici, avec le reste de ce qui décide quand le coffre se ferme, et
 * la règle qui va avec tient dans la fonction ci-dessous.
 */
export const AUTO_LOCK_MS = 5 * 60_000

/**
 * Temps restant avant la fermeture automatique, en millisecondes. Zéro veut dire
 * « fermer maintenant ».
 *
 * Une soustraction, et c'est tout l'intérêt : le compte se fait sur l'horloge et
 * non sur une minuterie. Une minuterie qui dort — onglet caché que le navigateur
 * ralentit, application suspendue par le système — se réveille en retard, et son
 * retard ferait passer une longue absence pour une courte. En repartant de
 * l'heure du dernier geste, une absence d'une heure rend zéro dès le réveil,
 * quel que soit le sommeil de la minuterie entre-temps.
 *
 * Le plancher à zéro n'est pas cosmétique : la valeur sert à reposer la
 * minuterie, et un délai négatif la ferait boucler sans fin.
 */
export function msBeforeAutoLock(lastActivity: number, now: number): number {
  return Math.max(0, lastActivity + AUTO_LOCK_MS - now)
}

export type PinVerdict =
  | { ok: true; secret: VaultSecret }
  | { ok: false; reason: 'wrong'; secret: VaultSecret; waitMs: number }
  | { ok: false; reason: 'cooling'; secret: VaultSecret; waitMs: number }

/**
 * Décide du sort d'une saisie, à partir de l'empreinte déjà calculée.
 *
 * Prendre l'empreinte en entrée plutôt que le code lui-même est ce qui rend
 * cette fonction pure : la dérivation traverse le pont natif, la décision non.
 *
 * Rien n'est persisté ici. Le secret mis à jour est renvoyé, et c'est l'appelant
 * qui l'écrit, ce qui laisse le choix du moment et rend la fonction rejouable
 * dans un test sans stockage.
 */
export function judgePin(
  candidateHash: string,
  secret: VaultSecret,
  now: number,
): PinVerdict {
  if (secret.lockedUntil !== null && now < secret.lockedUntil) {
    return { ok: false, reason: 'cooling', secret, waitMs: secret.lockedUntil - now }
  }

  if (candidateHash === secret.hash) {
    return { ok: true, secret: { ...secret, failures: 0, lockedUntil: null } }
  }

  const failures = secret.failures + 1
  const waitMs = delayForFailures(failures)
  return {
    ok: false,
    reason: 'wrong',
    secret: { ...secret, failures, lockedUntil: waitMs > 0 ? now + waitMs : null },
    waitMs,
  }
}
