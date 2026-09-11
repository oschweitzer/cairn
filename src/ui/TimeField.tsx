import { SEGMENTS_HEURE, SEPARATEUR_HEURE } from '@/google/creneau'
import { SegmentedField } from './SegmentedField'

/**
 * Entering a time: two parts of two digits, the ":" between them being drawn
 * and not typed. See `SegmentedField` for why.
 */
export function TimeField({
  label,
  value,
  onChangeText,
}: {
  label: string
  /** The time as "HH:MM", the only format `lireCreneau` knows. */
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
