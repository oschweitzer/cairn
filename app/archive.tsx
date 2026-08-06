import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import { useUpdateNote } from '@/db/queries'
import { useNoteList } from '@/db/select'
import { useTheme } from '@/ui/ThemeProvider'
import { Card, Inscription, Txt } from '@/ui/components'
import { IconButton } from '@/ui/IconButton'
import { MasonryGrid } from '@/ui/MasonryGrid'
import { NoteCard, estimateCardHeight } from '@/ui/NoteCard'
import { RuneLoader } from '@/ui/RuneLoader'
import { radius, space } from '@/ui/theme'

export default function Archive() {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const { notes, isLoading } = useNoteList({ view: 'archived' })
  const updateNote = useUpdateNote()

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="arrow-left" label="Retour" onPress={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.md }}
      >
        <Inscription>Archive</Inscription>

        {isLoading ? (
          <RuneLoader message="On ouvre l’archive…" />
        ) : notes.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
            <Feather name="archive" size={24} color={theme.text.muted} />
            <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
              Rien d’archivé. Les notes archivées quittent la grille sans partir à la corbeille.
            </Txt>
          </Card>
        ) : (
          <MasonryGrid
            items={notes}
            keyExtractor={(n) => n.id}
            estimateHeight={estimateCardHeight}
            renderItem={(note) => (
              <View style={{ gap: space.xs }}>
                <NoteCard
                  note={note}
                  onPress={() => router.push(`/note/${note.id}`)}
                  onTogglePin={() =>
                    updateNote.mutate({ id: note.id, patch: { is_pinned: !note.is_pinned } })
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Désarchiver ${note.title ?? 'la note'}`}
                  onPress={() => updateNote.mutate({ id: note.id, patch: { is_archived: false } })}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: theme.line.strong,
                    backgroundColor: pressed ? theme.surface.raised : 'transparent',
                  })}
                >
                  <Txt variant="caption" tone="secondary">
                    Désarchiver
                  </Txt>
                </Pressable>
              </View>
            )}
          />
        )}
      </ScrollView>
    </View>
  )
}
