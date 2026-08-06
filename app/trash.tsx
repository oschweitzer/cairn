import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { usePurgeNote, usePurgeNotes, useRestoreNote } from '@/db/queries'
import { useTrashedNoteList } from '@/db/select'
import { useTheme } from '@/ui/ThemeProvider'
import { Card, Inscription, Seam, Txt } from '@/ui/components'
import { IconButton } from '@/ui/IconButton'
import { RuneLoader } from '@/ui/RuneLoader'
import { radius, space } from '@/ui/theme'

/**
 * Corbeille. Volontairement une liste plate et non la grille : ici on ne
 * parcourt pas du contenu, on décide de restaurer ou de détruire. Les actions
 * comptent plus que l'aperçu.
 *
 * Cette vue n'est pas persistée dans le cache disque, comme le coffre.
 */
export default function Trash() {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const { notes, isLoading } = useTrashedNoteList()
  const restore = useRestoreNote()
  const purge = usePurgeNote()
  const purgeMany = usePurgeNotes()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)


  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="arrow-left" label="Retour" onPress={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.md }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Inscription style={{ flex: 1 }}>Corbeille</Inscription>
          {notes.length > 0 && !emptying ? (
            <Action label="Tout vider" tone="danger" compact onPress={() => setEmptying(true)} />
          ) : null}
        </View>

        {emptying ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="title" tone="danger">
              Vider toute la corbeille
            </Txt>
            <Txt variant="body" tone="secondary">
              {notes.length === 1
                ? 'Une note sera supprimée définitivement.'
                : `${notes.length} notes seront supprimées définitivement.`}{' '}
              Sans retour possible.
            </Txt>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Action
                label="Vider définitivement"
                tone="danger"
                onPress={() => {
                  purgeMany.mutate(notes.map((n) => n.id))
                  setEmptying(false)
                }}
              />
              <Action label="Annuler" onPress={() => setEmptying(false)} />
            </View>
          </Card>
        ) : null}

        {isLoading ? (
          <RuneLoader message="On fouille la corbeille…" />
        ) : notes.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
            <Feather name="trash-2" size={24} color={theme.text.muted} />
            <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
              La corbeille est vide.
            </Txt>
          </Card>
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {notes.map((note, index) => (
              <View key={note.id}>
                {index > 0 ? <Seam /> : null}
                <View style={{ padding: space.md, gap: space.sm }}>
                  <Txt variant="title" numberOfLines={1}>
                    {note.code_name ?? note.title ?? 'Note sans titre'}
                  </Txt>
                  {note.body ? (
                    <Txt variant="body" tone="muted" numberOfLines={2}>
                      {note.body}
                    </Txt>
                  ) : null}

                  {confirming === note.id ? (
                    <View style={{ gap: space.sm }}>
                      <Txt variant="caption" tone="danger">
                        Suppression définitive, sans retour possible.
                      </Txt>
                      <View style={{ flexDirection: 'row', gap: space.sm }}>
                        <Action
                          label="Supprimer définitivement"
                          tone="danger"
                          onPress={() => {
                            purge.mutate(note.id)
                            setConfirming(null)
                          }}
                        />
                        <Action label="Annuler" onPress={() => setConfirming(null)} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      <Action label="Restaurer" onPress={() => restore.mutate(note.id)} />
                      <Action
                        label="Supprimer"
                        tone="danger"
                        onPress={() => setConfirming(note.id)}
                      />
                    </View>
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}

        <Txt variant="caption" tone="muted">
          Une note mise à la corbeille y reste jusqu’à suppression manuelle. Rien n’est purgé
          automatiquement.
        </Txt>
      </ScrollView>
    </View>
  )
}

function Action({
  label,
  onPress,
  tone = 'default',
  compact = false,
}: {
  label: string
  onPress: () => void
  tone?: 'default' | 'danger'
  /** Sans flex, pour un bouton posé dans une ligne d'en-tête. */
  compact?: boolean
}) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: compact ? undefined : 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: tone === 'danger' ? theme.state.danger : theme.line.strong,
        backgroundColor: pressed ? theme.surface.raised : 'transparent',
      })}
    >
      <Txt variant="caption" tone={tone === 'danger' ? 'danger' : 'secondary'}>
        {label}
      </Txt>
    </Pressable>
  )
}
