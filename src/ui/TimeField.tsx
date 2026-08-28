import { SEGMENTS_HEURE, SEPARATEUR_HEURE } from '@/google/creneau'
import { SegmentedField } from './SegmentedField'

/**
 * Saisie d'une heure : deux moitiés de deux chiffres, le « : » entre elles
 * étant dessiné et non tapé. Voir `SegmentedField` pour la raison.
 */
export function TimeField({
  label,
  value,
  onChangeText,
}: {
  label: string
  /** L'heure au format « HH:MM », le seul que `lireCreneau` connaisse. */
  value: string
  onChangeText: (heure: string) => void
}) {
  return (
    <SegmentedField
      label={label}
      value={value}
      onChangeText={onChangeText}
      segments={SEGMENTS_HEURE}
      separateur={SEPARATEUR_HEURE}
    />
  )
}
