import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCreateNote } from '@/db/queries'
import { useAuth } from '@/auth/AuthProvider'
import { useTheme } from '@/ui/ThemeProvider'
import { Card, Txt } from '@/ui/components'
import { RuneLoader } from '@/ui/RuneLoader'
import { space } from '@/ui/theme'

/**
 * Quick creation, opened by a deep link.
 *
 * `cairn://nouvelle?kind=note` and `cairn://nouvelle?kind=checklist`: that is
 * what the Android widget's two buttons trigger. The screen only creates the
 * note and replaces itself with its editor — it has nothing to show, except
 * during the second the database takes to answer.
 *
 * `router.replace` and not `push`: this screen has no reason to stay in the
 * stack. Otherwise, going back from the freshly created note would land here
 * again, which would create a second one right away.
 */
export default function CreationRapide() {
  const { kind } = useLocalSearchParams<{ kind?: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const { session, loading } = useAuth()
  const createNote = useCreateNote()

  /**
   * A single creation, whatever happens.
   *
   * The effect replays on every change of session or router, and a creation
   * triggered twice would leave an empty note behind. The guard is a `ref` and
   * not state: it must above all not cause a render, otherwise it would replay
   * the very effect it is meant to hold back.
   */
  const started = useRef(false)

  useEffect(() => {
    // Without a session, nothing to create: the root routing sends to sign-in,
    // and the link will resume its course once signed in.
    if (loading || !session || started.current) return
    started.current = true

    void (async () => {
      try {
        const note = await createNote.mutateAsync({
          kind: kind === 'checklist' ? 'checklist' : 'note',
        })
        router.replace(`/note/${note.id}`)
      } catch {
        // The grid is the only honest fallback: it shows what exists, and does
        // not claim to have created anything.
        router.replace('/')
      }
    })()
  }, [kind, loading, session, createNote, router])

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surface.page,
        justifyContent: 'center',
        padding: space.xl,
      }}
    >
      {createNote.isError ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="title" tone="danger">
            Création impossible
          </Txt>
          <Txt variant="body" tone="secondary">
            La note n’a pas pu être créée. On revient à la grille.
          </Txt>
        </Card>
      ) : (
        <RuneLoader message="On taille la pierre…" />
      )}
    </View>
  )
}
