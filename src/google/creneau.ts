/**
 * Reading and validating the entered slot, with nothing from React.
 *
 * Kept apart from the screen to be put to the test by `npm run test:logic`.
 * Dates are the kind of subject where you think you are right: 31/02 lets
 * itself be built by `new Date`, which shifts it to 3 March without complaint,
 * and a slot straddling midnight ends before it starts. These cases are tested,
 * not proofread.
 *
 * French format on entry — JJ/MM/AAAA and HH:MM — because the app is in French,
 * and a date field that expects American order without saying so produces
 * appointments on the wrong day eleven times out of twelve.
 */

import type { Segment } from '../ui/segments'

export type Creneau = { debut: Date; fin: Date }
export type LectureCreneau = { ok: true; creneau: Creneau } | { ok: false; erreur: string }

/** Durations offered, in minutes. The first is the default. */
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
 * The parts the entry presents, separately.
 *
 * They live here, with the reading of the format, and not in the field that
 * displays them: « JJ/MM/AAAA » and « HH:MM » are decided in this file, and two
 * places describing the same format end up no longer describing it the same
 * way. The field, for its part, only knows parts made of digits.
 */
export const SEGMENTS_DATE: readonly Segment[] = [
  { label: 'Jour', longueur: 2, placeholder: 'JJ', zeroDevant: true },
  { label: 'Mois', longueur: 2, placeholder: 'MM', zeroDevant: true },
  { label: 'Année', longueur: 4, placeholder: 'AAAA', zeroDevant: false },
]

export const SEPARATEUR_DATE = '/'

export const SEGMENTS_HEURE: readonly Segment[] = [
  { label: 'Heures', longueur: 2, placeholder: 'HH', zeroDevant: true },
  { label: 'Minutes', longueur: 2, placeholder: 'MM', zeroDevant: true },
]

export const SEPARATEUR_HEURE = ':'

/**
 * The opening suggestion: the next round hour.
 *
 * Not "now", which would give 14:37 and force two digits to be corrected before
 * even starting. Nor a fixed hour like 9:00, which would be in the past one time
 * out of two.
 */
export function prochainCreneau(maintenant: Date = new Date()): { date: string; heure: string } {
  const d = new Date(maintenant)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return { date: formaterDate(d), heure: formaterHeure(d) }
}

/** Shifts a JJ/MM/AAAA date by a number of days. */
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
   * The check that matters: read the built date back.
   *
   * `new Date(2026, 1, 31)` does not throw, it returns 3 March. Comparing the
   * components afterwards is the only safe way to reject a 31 February, a 31
   * April or a 29 February in a common year — and that is indeed what we want,
   * rather than an appointment silently moved.
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
 * Builds the slot, or says what is wrong.
 *
 * One message at a time, the first problem encountered: showing "invalid date
 * and invalid time" when only the date is wrong sends people to fix what was
 * already fine.
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
   * The past is refused, with one minute of tolerance.
   *
   * Without it, confirming at 14:00:30 a slot entered at 14:00 would fail over
   * half a minute — a refusal that makes no sense to someone who has just read
   * the time on screen.
   */
  if (debut.getTime() < maintenant.getTime() - 60_000) {
    return { ok: false, erreur: 'Ce créneau est déjà passé.' }
  }

  return { ok: true, creneau: { debut, fin } }
}

/** « mardi 12 août à 14:00 », to confirm what is about to be sent. */
export function decrireCreneau(creneau: Creneau): string {
  const jour = creneau.debut.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return `${jour} à ${formaterHeure(creneau.debut)} – ${formaterHeure(creneau.fin)}`
}
