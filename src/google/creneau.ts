/**
 * Lecture et validation du créneau saisi, sans rien de React.
 *
 * Séparé de l'écran pour être éprouvé par `npm run test:logic`. Les dates sont
 * le genre de sujet où l'on croit avoir raison : 31/02 se laisse construire par
 * `new Date`, qui le décale au 3 mars sans se plaindre, et un créneau à cheval
 * sur minuit finit avant de commencer. Ces cas se testent, ils ne se relisent
 * pas.
 *
 * Format français à la saisie — JJ/MM/AAAA et HH:MM — parce que l'application
 * est en français et qu'un champ de date qui attend l'ordre américain sans le
 * dire produit des rendez-vous au mauvais jour onze fois sur douze.
 */

export type Creneau = { debut: Date; fin: Date }
export type LectureCreneau = { ok: true; creneau: Creneau } | { ok: false; erreur: string }

/** Durées proposées, en minutes. La première est le défaut. */
export const DUREES = [60, 30, 120] as const

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0')
}

export function formaterDate(d: Date): string {
  return `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function formaterHeure(d: Date): string {
  return `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`
}

/**
 * Ne garde que les chiffres, deux au plus. Une moitié d'heure ne peut rien
 * contenir d'autre : ni séparateur, ni espace collé par un copier-coller.
 */
function deuxChiffresAuPlus(valeur: string): string {
  return valeur.replace(/\D/g, '').slice(0, 2)
}

/**
 * Découpe une heure « HH:MM » en ses deux moitiés, pour une saisie qui les
 * sépare. Ce qui n'est pas un chiffre tombe, et une moitié absente rend une
 * chaîne vide plutôt que rien : le champ correspondant s'affiche vide, pas
 * incontrôlé.
 */
export function separerHeure(valeur: string): { heures: string; minutes: string } {
  const [h = '', m = ''] = valeur.split(':')
  return { heures: deuxChiffresAuPlus(h), minutes: deuxChiffresAuPlus(m) }
}

/** Recompose les deux moitiés dans le seul format que `lireCreneau` connaît. */
export function composerHeure(heures: string, minutes: string): string {
  return `${deuxChiffresAuPlus(heures)}:${deuxChiffresAuPlus(minutes)}`
}

/**
 * Complète les moitiés laissées à un seul chiffre, une fois la saisie finie.
 *
 * Le zéro va devant, comme sur une horloge : « 9 » minutes, ce sont neuf
 * minutes après l'heure, pas cinquante. Une moitié restée vide n'est pas
 * devinée — mettre « 00 » à la place choisirait une heure que personne n'a
 * saisie, alors que la laisser vide fait dire au panneau ce qu'il attend.
 */
export function completerHeure(valeur: string): string {
  const { heures, minutes } = separerHeure(valeur)
  if (!heures || !minutes) return valeur
  return `${heures.padStart(2, '0')}:${minutes.padStart(2, '0')}`
}

/**
 * Proposition d'ouverture : la prochaine heure ronde.
 *
 * Pas « maintenant », qui donnerait 14:37 et obligerait à corriger deux chiffres
 * avant même de commencer. Pas non plus une heure fixe comme 9:00, qui serait
 * dans le passé une fois sur deux.
 */
export function prochainCreneau(maintenant: Date = new Date()): { date: string; heure: string } {
  const d = new Date(maintenant)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return { date: formaterDate(d), heure: formaterHeure(d) }
}

/** Décale une date au format JJ/MM/AAAA d'un nombre de jours. */
export function decalerJours(date: string, jours: number): string {
  const parts = analyserDate(date)
  if (!parts) return date
  const d = new Date(parts.annee, parts.mois - 1, parts.jour)
  d.setDate(d.getDate() + jours)
  return formaterDate(d)
}

function analyserDate(
  valeur: string,
): { jour: number; mois: number; annee: number } | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valeur.trim())
  if (!m) return null
  const jour = Number(m[1])
  const mois = Number(m[2])
  const annee = Number(m[3])

  /**
   * Le contrôle qui compte : relire la date construite.
   *
   * `new Date(2026, 1, 31)` ne lève pas, il rend le 3 mars. Comparer les
   * composantes après coup est le seul moyen sûr de refuser un 31 février, un
   * 31 avril ou un 29 février d'année commune — et c'est bien ce qu'on veut,
   * plutôt qu'un rendez-vous silencieusement déplacé.
   */
  const d = new Date(annee, mois - 1, jour)
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return null
  }
  return { jour, mois, annee }
}

function analyserHeure(valeur: string): { heures: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(valeur.trim())
  if (!m) return null
  const heures = Number(m[1])
  const minutes = Number(m[2])
  if (heures > 23 || minutes > 59) return null
  return { heures, minutes }
}

/**
 * Construit le créneau, ou dit ce qui cloche.
 *
 * Un seul message à la fois, celui du premier problème rencontré : afficher
 * « date invalide et heure invalide » quand seule la date est fautive envoie
 * corriger ce qui allait déjà bien.
 */
export function lireCreneau(
  date: string,
  heure: string,
  dureeMinutes: number,
  maintenant: Date = new Date(),
): LectureCreneau {
  const jour = analyserDate(date)
  if (!jour) return { ok: false, erreur: 'Date attendue au format JJ/MM/AAAA.' }

  const h = analyserHeure(heure)
  if (!h) return { ok: false, erreur: 'Heure attendue au format HH:MM.' }

  if (dureeMinutes <= 0) return { ok: false, erreur: 'La durée doit être positive.' }

  const debut = new Date(jour.annee, jour.mois - 1, jour.jour, h.heures, h.minutes, 0, 0)
  const fin = new Date(debut.getTime() + dureeMinutes * 60_000)

  /**
   * Le passé est refusé, avec une minute de tolérance.
   *
   * Sans elle, valider à 14:00:30 un créneau saisi à 14:00 échouerait pour une
   * demi-minute — un refus incompréhensible du point de vue de qui vient de
   * lire l'heure à l'écran.
   */
  if (debut.getTime() < maintenant.getTime() - 60_000) {
    return { ok: false, erreur: 'Ce créneau est déjà passé.' }
  }

  return { ok: true, creneau: { debut, fin } }
}

/** « mardi 12 août à 14:00 », pour confirmer ce qui va partir. */
export function decrireCreneau(creneau: Creneau): string {
  const jour = creneau.debut.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return `${jour} à ${formaterHeure(creneau.debut)} – ${formaterHeure(creneau.fin)}`
}
