import { SEGMENTS_DATE, SEPARATEUR_DATE } from '@/google/creneau'
import { SegmentedField } from './SegmentedField'

/**
 * Saisie d'une date : jour, mois et année, les « / » entre eux étant dessinés
 * et non tapés. Voir `SegmentedField` pour la raison.
 */
export function DateField({
  label,
  value,
  onChangeText,
}: {
  label: string
  /** La date au format « JJ/MM/AAAA », le seul que `lireCreneau` connaisse. */
  value: string
  onChangeText: (date: string) => void
}) {
  return (
    <SegmentedField
      label={label}
      value={value}
      onChangeText={onChangeText}
      segments={SEGMENTS_DATE}
      separateur={SEPARATEUR_DATE}
    />
  )
}
