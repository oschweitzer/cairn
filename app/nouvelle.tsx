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
 * Création rapide, ouverte par un lien profond.
 *
 * `cairn://nouvelle?kind=note` et `cairn://nouvelle?kind=checklist` : c'est ce
 * que les deux boutons du widget Android déclenchent. L'écran ne fait que créer
 * la note et se remplacer par son éditeur — il n'a rien à montrer, sinon
 * pendant la seconde où la base répond.
 *
 * `router.replace` et non `push` : cet écran n'a aucune raison de rester dans la
 * pile. Sans cela, le retour depuis la note fraîchement créée retomberait ici,
 * qui en créerait aussitôt une seconde.
 */
export default function CreationRapide() {
  const { kind } = useLocalSearchParams<{ kind?: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const { session, loading } = useAuth()
  const createNote = useCreateNote()

  /**
   * Une seule création, quoi qu'il arrive.
   *
   * L'effet se rejoue à chaque changement de session ou de routeur, et une
   * création déclenchée deux fois laisserait une note vide derrière elle. Le
   * garde est un `ref` et non un état : il ne doit surtout pas provoquer de
   * rendu, sans quoi il rejouerait l'effet qu'il est censé retenir.
   */
  const started = useRef(false)

  useEffect(() => {
    // Sans session, rien à créer : l'aiguillage de la racine envoie vers la
    // connexion, et le lien reprendra son cours une fois connecté.
    if (loading || !session || started.current) return
    started.current = true

    void (async () => {
      try {
        const note = await createNote.mutateAsync({
          kind: kind === 'checklist' ? 'checklist' : 'note',
        })
        router.replace(`/note/${note.id}`)
      } catch {
        // La grille est le seul repli honnête : elle montre ce qui existe, et
        // ne prétend pas avoir créé quoi que ce soit.
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
