import { useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import type { Tag } from '@/db/types'
import { useTheme } from './ThemeProvider'
import { Txt, noWebOutline, useFocusRing } from './components'
import { Tooltip } from './Tooltip'
import { radius, space, tagColorKeys, tagPalette, type, type TagColorKey } from './theme'

/**
 * Note colour picker. The first choice is no colour, which is the default state
 * and must stay reachable in one gesture.
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
      {/* A colour swatch does not say its name, and « bruyère » cannot be guessed
          from a purple. The tooltip is the only way to read the palette here. */}
      <Tooltip label="Aucune couleur">
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
      </Tooltip>

      {tagColorKeys.map((key) => {
        const active = value === key
        return (
          <Tooltip key={key} label={tagPalette[key].label}>
            <Pressable
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
          </Tooltip>
        )
      })}
    </ScrollView>
  )
}

/**
 * Attaching tags to a note. A list of toggles rather than a text field: tags are
 * few, and all you do here is tick.
 *
 * `onCreate` adds a way to create one without leaving the screen. Optional,
 * because not every caller is allowed to write to the tags table — and because
 * one more text field has no business where all you do is filter.
 */
export function TagPicker({
  tags,
  selectedIds,
  onToggle,
  emptyHint,
  onCreate,
  creating = false,
  createError,
}: {
  tags: Tag[]
  selectedIds: string[]
  onToggle: (tagId: string) => void
  emptyHint: string
  /** Receives the typed name, already trimmed. When absent, no creation field is rendered. */
  onCreate?: (name: string) => void
  creating?: boolean
  createError?: string | null
}) {
  const { theme, tagColor } = useTheme()

  return (
    <View style={{ gap: space.sm }}>
      {tags.length === 0 ? (
        <Txt variant="caption" tone="muted">
          {emptyHint}
        </Txt>
      ) : (
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
      )}

      {onCreate ? (
        <TagCreator onCreate={onCreate} busy={creating} error={createError} />
      ) : null}
    </View>
  )
}

/**
 * Tag creation field, set under the toggles.
 *
 * The draft lives here and not with the caller: it is screen state that does
 * not outlive the panel closing, and lifting it up would force every screen to
 * carry it for nothing.
 *
 * No colour choice, on purpose. The panel unfolds above the action bar, in the
 * little room the keyboard leaves, and colour is not the decision made when
 * putting a tag on a note — it is adjusted in the Tags tab, where it is the
 * subject. The hue offered is the least used in the palette, which avoids
 * ending up with ten tags of the same colour when creating them on the fly.
 */
function TagCreator({
  onCreate,
  busy,
  error,
}: {
  onCreate: (name: string) => void
  busy: boolean
  error?: string | null
}) {
  const { theme } = useTheme()
  const [draft, setDraft] = useState('')
  const focus = useFocusRing()

  const name = draft.trim()

  function submit() {
    if (!name || busy) return
    setDraft('')
    onCreate(name)
  }

  return (
    <View style={{ gap: space.xxs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Créer un tag"
          placeholderTextColor={theme.text.muted}
          accessibilityLabel="Nom du nouveau tag"
          returnKeyType="done"
          // Tags are chained without having to click back into the field.
          blurOnSubmit={false}
          onSubmitEditing={submit}
          style={[
            {
              flex: 1,
              minHeight: 40,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: focus.focused ? 2 : 1,
              borderColor: focus.focused ? theme.accent.default : theme.line.hairline,
              backgroundColor: theme.surface.recessed,
              color: theme.text.primary,
              fontFamily: type.label.fontFamily,
              fontSize: type.label.fontSize,
            },
            noWebOutline,
          ]}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
        />
        {/* The return key stays the quick gesture, but it cannot be the only
            one: with a mouse nobody looks for it, and some software keyboards
            insert a line break instead of submitting. */}
        <Tooltip label="Créer le tag et le poser sur la note">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Créer le tag"
            accessibilityState={{ disabled: !name || busy, busy }}
            disabled={!name || busy}
            onPress={submit}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: theme.accent.default,
              backgroundColor: pressed ? theme.accent.pressed : theme.accent.default,
              opacity: name && !busy ? 1 : 0.45,
            })}
          >
            <Feather name="plus" size={18} color={theme.text.onAccent} />
          </Pressable>
        </Tooltip>
      </View>
      {error ? (
        <Txt variant="caption" tone="danger">
          {error}
        </Txt>
      ) : null}
    </View>
  )
}
