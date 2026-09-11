/**
 * Splitting an entry into parts, for fields that carry a separator.
 *
 * A time « HH:MM », a date « JJ/MM/AAAA »: the separator there is punctuation a
 * phone's numeric keypad does not provide. So these fields draw it instead of
 * having it typed, and each part is entered separately. This module goes back
 * and forth between the complete string — the only format the slot reader
 * knows — and the parts on display.
 *
 * With no React, to be put to the test by `npm run test:logic`: it is string
 * handling, and that is where one-digit mistakes hide.
 */

export type Segment = {
  /** What a screen reader announces on this part. */
  label: string
  /** Number of digits, which is also the maximum length that can be entered. */
  longueur: number
  placeholder: string
  /**
   * True if a lone digit is completed with a leading zero on leaving the field.
   * The year does not do it: "26" is not the year 26, and completing it to 2026
   * would pick a century nobody typed.
   */
  zeroDevant: boolean
}

/** Keeps only the digits, and no more than the part accepts. */
export function chiffres(valeur: string, longueur: number): string {
  return valeur.replace(/\D/g, '').slice(0, longueur)
}

/**
 * Splits the complete string into parts. A missing part yields an empty string
 * rather than nothing: the matching field displays empty, not uncontrolled.
 */
export function separerSegments(
  valeur: string,
  separateur: string,
  segments: readonly Segment[],
): string[] {
  const parts = valeur.split(separateur)
  return segments.map((s, i) => chiffres(parts[i] ?? '', s.longueur))
}

/** Puts the parts back together in the only format the slot reader knows. */
export function composerSegments(
  parts: readonly string[],
  separateur: string,
  segments: readonly Segment[],
): string {
  return segments.map((s, i) => chiffres(parts[i] ?? '', s.longueur)).join(separateur)
}

/**
 * Completes the parts left at a single digit, once the entry is done.
 *
 * The zero goes in front, as on a clock or a calendar: "9" minutes means nine
 * minutes past the hour, not fifty. A part left empty is not guessed — putting
 * "00" in its place would pick a value nobody typed, whereas leaving it empty
 * makes the panel say what it expects.
 */
export function completerSegments(
  valeur: string,
  separateur: string,
  segments: readonly Segment[],
): string {
  const parts = separerSegments(valeur, separateur, segments)
  return segments
    .map((s, i) => (s.zeroDevant && parts[i] ? parts[i].padStart(s.longueur, '0') : parts[i]))
    .join(separateur)
}
