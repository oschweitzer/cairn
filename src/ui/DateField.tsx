import { SEGMENTS_DATE, SEPARATEUR_DATE } from '@/google/creneau'
import { SegmentedField } from './SegmentedField'

/**
 * Entering a date: day, month and year, the "/" between them being drawn and
 * not typed. See `SegmentedField` for why.
 */
export function DateField({
  label,
  value,
  onChangeText,
}: {
  label: string
  /** The date as "JJ/MM/AAAA", the only format `lireCreneau` knows. */
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
