/**
 * Découpage d'une saisie en moitiés, pour les champs qui portent un séparateur.
 *
 * Une heure « HH:MM », une date « JJ/MM/AAAA » : le séparateur y est une
 * ponctuation que le clavier numérique d'un téléphone ne donne pas. Ces champs
 * le dessinent donc au lieu de le faire taper, et chaque moitié se saisit à
 * part. Ce module fait le va-et-vient entre la chaîne complète — le seul format
 * que la lecture du créneau connaisse — et les moitiés affichées.
 *
 * Sans React, pour être éprouvé par `npm run test:logic` : c'est de la
 * manipulation de chaînes, et c'est là que se logent les erreurs d'un chiffre.
 */

export type Segment = {
  /** Ce qu'un lecteur d'écran annonce sur cette moitié. */
  label: string
  /** Nombre de chiffres, qui est aussi la longueur maximale saisissable. */
  longueur: number
  placeholder: string
  /**
   * Vrai si un chiffre seul se complète d'un zéro devant à la sortie du champ.
   * L'année ne le fait pas : « 26 » n'est pas l'an 26, et le compléter en 2026
   * choisirait un siècle que personne n'a saisi.
   */
  zeroDevant: boolean
}

/** Ne garde que les chiffres, et pas plus que la moitié n'en accepte. */
export function chiffres(valeur: string, longueur: number): string {
  return valeur.replace(/\D/g, '').slice(0, longueur)
}

/**
 * Découpe la chaîne complète en moitiés. Une moitié absente rend une chaîne
 * vide plutôt que rien : le champ correspondant s'affiche vide, pas incontrôlé.
 */
export function separerSegments(
  valeur: string,
  separateur: string,
  segments: readonly Segment[],
): string[] {
  const parts = valeur.split(separateur)
  return segments.map((s, i) => chiffres(parts[i] ?? '', s.longueur))
}

/** Recompose les moitiés dans le seul format que la lecture du créneau connaît. */
export function composerSegments(
  parts: readonly string[],
  separateur: string,
  segments: readonly Segment[],
): string {
  return segments.map((s, i) => chiffres(parts[i] ?? '', s.longueur)).join(separateur)
}

/**
 * Complète les moitiés laissées à un seul chiffre, une fois la saisie finie.
 *
 * Le zéro va devant, comme sur une horloge ou un calendrier : « 9 » minutes, ce
 * sont neuf minutes après l'heure, pas cinquante. Une moitié restée vide n'est
 * pas devinée — mettre « 00 » à la place choisirait une valeur que personne n'a
 * saisie, alors que la laisser vide fait dire au panneau ce qu'il attend.
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
