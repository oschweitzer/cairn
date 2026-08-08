import { useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import type { Tag } from '@/db/types'
import { useTheme } from './ThemeProvider'
import { Txt, noWebOutline, useFocusRing } from './components'
import { Tooltip } from './Tooltip'
import { radius, space, tagColorKeys, tagPalette, type, type TagColorKey } from './theme'

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
      {/* Une pastille de couleur ne dit pas son nom, et « bruyère » ne se devine
          pas d'un violet. La bulle est ici la seule façon de lire la palette. */}
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
 * Association de tags à une note. Liste de bascules plutôt qu'un champ de
 * saisie : les tags sont peu nombreux, on ne fait ici que cocher.
 *
 * `onCreate` ajoute de quoi en créer un sans quitter l'écran. Facultatif, parce
 * que tous les appelants n'ont pas le droit d'écrire dans la table des tags —
 * et parce qu'un champ de saisie de plus n'a rien à faire là où l'on ne fait
 * que filtrer.
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
  /** Reçoit le nom saisi, déjà rogné. Absent, aucun champ de création n'est rendu. */
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
 * Champ de création d'un tag, posé sous les bascules.
 *
 * Le brouillon vit ici et non chez l'appelant : c'est un état d'écran qui ne
 * survit pas à la fermeture du panneau, et le remonter obligerait chaque écran
 * à le porter pour rien.
 *
 * Aucun choix de couleur, volontairement. Le panneau se déplie au-dessus de la
 * barre d'actions, dans le peu de place que laisse le clavier, et la couleur
 * n'est pas la décision qu'on prend en posant un tag sur une note — elle se
 * retouche dans l'onglet Tags, où c'est le sujet. La teinte proposée est la
 * moins servie de la palette, ce qui évite d'obtenir dix tags de la même
 * couleur en les créant à la volée.
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
          // On enchaîne les tags sans avoir à recliquer dans le champ.
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
        {/* La touche entrée reste le geste rapide, mais elle ne peut pas être le
            seul : à la souris on ne la cherche pas, et certains claviers
            logiciels renvoient à la ligne au lieu de valider. */}
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
