import { useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from '@/db/queries'
import { useTagUsage } from '@/db/select'
import { useTheme } from '@/ui/ThemeProvider'
import { Card, Inscription, Seam, Txt, noWebOutline, useFocusRing } from '@/ui/components'
import { ColorPicker } from '@/ui/pickers'
import { Tooltip } from '@/ui/Tooltip'
import { radius, space, tagColorKeys, type, type TagColorKey } from '@/ui/theme'

export default function TagsScreen() {
  const { theme, tagColor } = useTheme()
  const insets = useSafeAreaInsets()

  const tagsQuery = useTags()
  const usage = useTagUsage()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const deleteTag = useDeleteTag()

  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState<TagColorKey>('ambre')
  const [error, setError] = useState<string | null>(null)
  const [openColorFor, setOpenColorFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const nameFocus = useFocusRing()

  const tags = tagsQuery.data ?? []

  async function create() {
    const name = draftName.trim()
    setError(null)
    if (!name) return
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setError('Un tag porte déjà ce nom.')
      return
    }
    try {
      await createTag.mutateAsync({ name, colorKey: draftColor })
      setDraftName('')
      // La couleur avance dans la palette : créer plusieurs tags d'affilée ne
      // donne pas dix fois la même teinte.
      const next = tagColorKeys[(tagColorKeys.indexOf(draftColor) + 1) % tagColorKeys.length]
      setDraftColor(next)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface.page }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.lg,
        gap: space.md,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space.xs }}>
        <Inscription>Tags</Inscription>
        <Txt variant="body" tone="secondary">
          Dix teintes du Nord, remappées selon le thème actif.
        </Txt>
      </View>

      {/* Création */}
      <Card style={{ gap: space.sm }}>
        <Txt variant="title">Nouveau tag</Txt>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Nom du tag"
            placeholderTextColor={theme.text.muted}
            accessibilityLabel="Nom du nouveau tag"
            returnKeyType="done"
            onSubmitEditing={() => void create()}
            onFocus={nameFocus.onFocus}
            onBlur={nameFocus.onBlur}
            style={[
              {
                flex: 1,
                minHeight: 48,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                borderWidth: nameFocus.focused ? 2 : 1,
                borderColor: nameFocus.focused ? theme.accent.default : theme.line.hairline,
                backgroundColor: theme.surface.recessed,
                color: theme.text.primary,
                fontFamily: type.body.fontFamily,
                fontSize: type.body.fontSize,
              },
              noWebOutline,
            ]}
          />
          <Tooltip label="Créer le tag">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Créer le tag"
              disabled={!draftName.trim()}
              onPress={() => void create()}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: theme.accent.default,
                backgroundColor: pressed ? theme.accent.pressed : theme.accent.default,
                opacity: draftName.trim() ? 1 : 0.45,
              })}
            >
              <Feather name="plus" size={20} color={theme.text.onAccent} />
            </Pressable>
          </Tooltip>
        </View>
        <ColorPicker value={draftColor} onChange={(next) => setDraftColor(next ?? 'ambre')} />
        {error ? (
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        ) : null}
      </Card>

      {/* Liste */}
      {tags.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
          <Feather name="tag" size={24} color={theme.text.muted} />
          <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
            Aucun tag. Le premier se crée juste au-dessus.
          </Txt>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {tags.map((tag, index) => {
            const count = usage.get(tag.id) ?? 0
            const deleting = confirmDelete === tag.id
            return (
              <View key={tag.id}>
                {index > 0 ? <Seam /> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    paddingHorizontal: space.md,
                    minHeight: 56,
                  }}
                >
                  <Tooltip label="Changer la couleur">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Changer la couleur de ${tag.name}`}
                      onPress={() => setOpenColorFor(openColorFor === tag.id ? null : tag.id)}
                      hitSlop={space.sm}
                      style={{ width: 32, height: 48, justifyContent: 'center' }}
                    >
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: tagColor(tag.color_key),
                        }}
                      />
                    </Pressable>
                  </Tooltip>

                  <TextInput
                    defaultValue={tag.name}
                    accessibilityLabel={`Renommer ${tag.name}`}
                    onEndEditing={(e) => {
                      const next = e.nativeEvent.text.trim()
                      if (next && next !== tag.name) {
                        updateTag.mutate({ id: tag.id, patch: { name: next } })
                      }
                    }}
                    style={[
                      {
                        flex: 1,
                        minHeight: 48,
                        color: theme.text.primary,
                        fontFamily: type.label.fontFamily,
                        fontSize: type.label.fontSize,
                      },
                      noWebOutline,
                    ]}
                  />

                  {deleting ? (
                    <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Confirmer la suppression de ${tag.name}`}
                        onPress={() => {
                          deleteTag.mutate(tag.id)
                          setConfirmDelete(null)
                        }}
                        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
                      >
                        <Txt variant="caption" tone="danger">
                          Supprimer
                        </Txt>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Annuler"
                        onPress={() => setConfirmDelete(null)}
                        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
                      >
                        <Txt variant="caption" tone="secondary">
                          Annuler
                        </Txt>
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <Txt variant="caption" tone="muted">
                        {count === 0 ? 'aucune note' : count === 1 ? '1 note' : `${count} notes`}
                      </Txt>
                      <Tooltip label="Supprimer le tag">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Supprimer ${tag.name}`}
                          onPress={() => setConfirmDelete(tag.id)}
                          hitSlop={space.sm}
                          style={{
                            width: 40,
                            height: 48,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Feather name="trash-2" size={16} color={theme.text.muted} />
                        </Pressable>
                      </Tooltip>
                    </>
                  )}
                </View>

                {openColorFor === tag.id ? (
                  <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
                    <ColorPicker
                      value={tag.color_key}
                      onChange={(next) => {
                        if (next) updateTag.mutate({ id: tag.id, patch: { color_key: next } })
                        setOpenColorFor(null)
                      }}
                    />
                  </View>
                ) : null}
              </View>
            )
          })}
        </Card>
      )}

      <Txt variant="caption" tone="muted">
        Supprimer un tag le retire des notes qui le portent, sans toucher aux notes elles-mêmes.
      </Txt>
    </ScrollView>
  )
}
