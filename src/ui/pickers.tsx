import { Pressable, ScrollView, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import type { Tag } from '@/db/types'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { radius, space, tagColorKeys, tagPalette, type TagColorKey } from './theme'

/**
 * Sélecteur de couleur de note. Le premier choix est l'absence de couleur, qui
 * est l'état par défaut et doit rester atteignable en un geste.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: TagColorKey | null
  onChange: (next: TagColorKey | null) => void
}) {
  const { theme, tagColor } = useTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: value === null }}
        accessibilityLabel="Aucune couleur"
        onPress={() => onChange(null)}
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: value === null ? 2 : 1,
          borderColor: value === null ? theme.accent.default : theme.line.hairline,
          backgroundColor: theme.surface.recessed,
        }}
      >
        <Feather name="slash" size={16} color={theme.text.muted} />
      </Pressable>

      {tagColorKeys.map((key) => {
        const active = value === key
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tagPalette[key].label}
            onPress={() => onChange(key)}
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: active ? 2 : 1,
              borderColor: active ? theme.accent.default : theme.line.hairline,
              backgroundColor: theme.surface.card,
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: tagColor(key),
              }}
            />
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

/**
 * Association de tags à une note. Liste de bascules plutôt qu'un champ de
 * saisie : les tags sont peu nombreux et déjà créés ailleurs, on ne fait ici que
 * cocher.
 */
export function TagPicker({
  tags,
  selectedIds,
  onToggle,
  emptyHint,
}: {
  tags: Tag[]
  selectedIds: string[]
  onToggle: (tagId: string) => void
  emptyHint: string
}) {
  const { theme, tagColor } = useTheme()

  if (tags.length === 0) {
    return (
      <Txt variant="caption" tone="muted">
        {emptyHint}
      </Txt>
    )
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {tags.map((tag) => {
        const active = selectedIds.includes(tag.id)
        return (
          <Pressable
            key={tag.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={tag.name}
            onPress={() => onToggle(tag.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              minHeight: 40,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: active ? 2 : 1,
              borderColor: active ? tagColor(tag.color_key) : theme.line.hairline,
              backgroundColor: active ? theme.accent.subtle : 'transparent',
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: tagColor(tag.color_key),
              }}
            />
            <Txt variant="label" tone={active ? 'primary' : 'secondary'}>
              {tag.name}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
