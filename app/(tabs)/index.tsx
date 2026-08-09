import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import {
  useCreateNote,
  useReorderNotes,
  useSetNotesArchived,
  useSetNotesPinned,
  useTags,
  useTrashNotes,
  useUpdateNote,
} from '@/db/queries'
import { displayTitle, moveNote } from '@/db/noteLogic'
import { useNoteList } from '@/db/select'
import type { NoteKind } from '@/db/types'
import { useTheme } from '@/ui/ThemeProvider'
import { Card, Logotype, Txt, noWebOutline, useFocusRing } from '@/ui/components'
import { ComposerButton } from '@/ui/ComposerButton'
import { IconButton } from '@/ui/IconButton'
import { MasonryGrid } from '@/ui/MasonryGrid'
import { NoteCard, estimateCardHeight } from '@/ui/NoteCard'
import { RuneLoader } from '@/ui/RuneLoader'
import { StandingStone } from '@/ui/runes'
import { Tooltip } from '@/ui/Tooltip'
import { radius, space, type } from '@/ui/theme'

export default function Notes() {
  const { theme, tagColor } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])

  const { notes, isLoading, isError, error, refetch, isRefetching } = useNoteList({
    view: 'active',
    tagIds,
    search,
  })
  const tagsQuery = useTags()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const reorderNotes = useReorderNotes()

  const [creating, setCreating] = useState(false)
  const searchFocus = useFocusRing()
  const filtering = search.trim().length > 0 || tagIds.length > 0

  // Sélection multiple. Le mode s'active dès qu'une note est retenue, et se
  // termine tout seul quand la dernière est désélectionnée : pas de bouton
  // « quitter » à trouver, et impossible de rester coincé dans un mode vide.
  const [rawSelectedIds, setRawSelectedIds] = useState<string[]>([])
  /**
   * Mode explicitement armé, indépendamment de ce qui est déjà retenu.
   *
   * L'appui long suffit au doigt mais se découvre mal à la souris, où maintenir
   * le bouton 350 millisecondes n'est pas un geste que l'on essaie spontanément.
   * Un bouton dédié rend l'entrée dans le mode visible sur les deux surfaces, et
   * permet d'armer la sélection avant d'avoir choisi la première note.
   */
  const [selectionArmed, setSelectionArmed] = useState(false)
  const trashNotes = useTrashNotes()
  const setNotesArchived = useSetNotesArchived()
  const setNotesPinned = useSetNotesPinned()

  /**
   * La sélection effective est dérivée, jamais élaguée dans un état.
   *
   * Une note retenue puis filtrée hors de la vue par une recherche resterait
   * sinon sélectionnée invisiblement, et une action en masse la toucherait sans
   * que rien ne l'annonce. La déduire à chaque rendu règle le problème sans
   * appeler setState pendant le rendu, ce qui bouclerait.
   */
  const selectedIds = useMemo(() => {
    const visible = new Set(notes.map((n) => n.id))
    return rawSelectedIds.filter((id) => visible.has(id))
  }, [rawSelectedIds, notes])

  const selectionMode = selectionArmed || selectedIds.length > 0

  const toggleSelected = useCallback((id: string) => {
    setSelectionArmed(true)
    setRawSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )
  }, [])

  const clearSelection = useCallback(() => {
    setRawSelectedIds([])
    setSelectionArmed(false)
  }, [])

  // Après une action en masse, la sélection n'a plus d'objet : les notes visées
  // ont changé d'état ou quitté la vue.
  const runOnSelection = useCallback(
    (action: (ids: string[]) => void) => {
      action(selectedIds)
      clearSelection()
    },
    [selectedIds, clearSelection],
  )

  const selectedNotes = notes.filter((n) => selectedIds.includes(n.id))
  // Un lot déjà entièrement épinglé propose le dépinglage, pas l'inverse.
  const allPinned = selectionMode && selectedNotes.every((n) => n.is_pinned)

  /**
   * Dépôt d'une carte sur une autre : la note prend la place de sa cible.
   *
   * La décision est dans `moveNote`, où elle est testée — c'est là que vit la
   * règle des épinglées en tête, et une règle d'ordre se vérifie bien mieux sur
   * un tableau que sur un écran.
   *
   * L'ordre complet est renvoyé au serveur, pas seulement les deux notes qui ont
   * bougé : déplacer une carte décale toutes celles qui la suivent, et n'écrire
   * que les extrémités laisserait des rangs en double.
   */
  const reorder = useCallback(
    (from: number, to: number) => {
      const next = moveNote(notes, from, to)
      reorderNotes.mutate({ orderedIds: next.map((n) => n.id) })
    },
    [notes, reorderNotes],
  )

  const create = useCallback(
    async (kind: NoteKind) => {
      setCreating(true)
      try {
        const note = await createNote.mutateAsync({ kind })
        router.push(`/note/${note.id}`)
      } finally {
        setCreating(false)
      }
    },
    [createNote, router],
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          // De la place sous la grille pour que les boutons de création ne
          // recouvrent jamais la dernière carte.
          paddingBottom: space.lg + 72,
          gap: space.md,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={theme.accent.default}
            colors={[theme.accent.default]}
            progressBackgroundColor={theme.surface.card}
          />
        }
      >
        {selectionMode ? (
          <SelectionBar
            count={selectedIds.length}
            allPinned={allPinned}
            allSelected={selectedIds.length === notes.length}
            onSelectAll={() => setRawSelectedIds(notes.map((n) => n.id))}
            onCancel={clearSelection}
            onPin={() =>
              runOnSelection((ids) => setNotesPinned.mutate({ ids, pinned: !allPinned }))
            }
            onArchive={() =>
              runOnSelection((ids) => setNotesArchived.mutate({ ids, archived: true }))
            }
            onDelete={() => runOnSelection((ids) => trashNotes.mutate(ids))}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Logotype style={{ flex: 1 }} />
            {notes.length > 0 ? (
              <IconButton
                icon="check-circle"
                label="Sélectionner des notes"
                tooltip="Sélectionner plusieurs notes"
                size="md"
                onPress={() => setSelectionArmed(true)}
              />
            ) : null}
          </View>
        )}

        {/* Recherche instantanée sur le cache : pas de latence par frappe, et
            elle continue de fonctionner hors ligne. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 48,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            // L'anneau de focus est repris en aurore : le bleu par défaut du
            // navigateur n'a rien à faire dans cette palette, mais la
            // navigation au clavier doit rester visible.
            borderWidth: searchFocus.focused ? 2 : 1,
            borderColor: searchFocus.focused ? theme.accent.default : theme.line.hairline,
            backgroundColor: theme.surface.recessed,
          }}
        >
          <Feather name="search" size={16} color={theme.text.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chercher un titre, un contenu, un tag"
            placeholderTextColor={theme.text.muted}
            accessibilityLabel="Rechercher"
            returnKeyType="search"
            onFocus={searchFocus.onFocus}
            onBlur={searchFocus.onBlur}
            style={[
              {
                flex: 1,
                minHeight: 48,
                color: theme.text.primary,
                fontFamily: type.body.fontFamily,
                fontSize: type.body.fontSize,
              },
              noWebOutline,
            ]}
          />
          {search.length > 0 ? (
            <Tooltip label="Effacer la recherche">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Effacer la recherche"
                onPress={() => setSearch('')}
                hitSlop={space.md}
              >
                <Feather name="x" size={16} color={theme.text.secondary} />
              </Pressable>
            </Tooltip>
          ) : null}
        </View>

        {(tagsQuery.data ?? []).length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingVertical: space.xxs }}
          >
            {(tagsQuery.data ?? []).map((tag) => {
              const active = tagIds.includes(tag.id)
              return (
                <Pressable
                  key={tag.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`Filtrer par ${tag.name}`}
                  onPress={() =>
                    setTagIds((current) =>
                      current.includes(tag.id)
                        ? current.filter((t) => t !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    height: 36,
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? tagColor(tag.color_key) : theme.line.hairline,
                    backgroundColor: active ? theme.accent.subtle : 'transparent',
                  }}
                >
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 3.5,
                      backgroundColor: tagColor(tag.color_key),
                    }}
                  />
                  <Txt variant="caption" tone={active ? 'primary' : 'secondary'}>
                    {tag.name}
                  </Txt>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {/* Une revalidation qui échoue alors que le cache contient des notes ne
            doit pas vider l'écran : hors ligne, le contenu déjà chargé reste la
            meilleure chose à montrer. L'erreur se signale alors par un bandeau,
            et ne prend toute la place que s'il n'y a réellement rien à afficher. */}
        {isError && notes.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.md,
              minHeight: 44,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.state.danger,
            }}
          >
            <Feather name="wifi-off" size={14} color={theme.state.danger} />
            <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
              Contenu affiché depuis le cache, la synchronisation a échoué.
            </Txt>
          </View>
        ) : null}

        {isError && notes.length === 0 ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="title" tone="danger">
              Lecture impossible
            </Txt>
            <Txt variant="body" tone="secondary">
              {(error as Error | null)?.message ?? 'Erreur inconnue.'}
            </Txt>
          </Card>
        ) : isLoading ? (
          <RuneLoader message="On dépile les pierres…" />
        ) : notes.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.md }}>
            {/**
             * Deux vides très différents, deux images différentes. Un filtre sans
             * résultat est un problème de recherche, l'icône de loupe est donc la
             * bonne réponse. Un espace réellement vide est une invitation à poser
             * la première pierre : c'est la pierre levée, pas un pictogramme.
             */}
            {filtering ? (
              <Feather name="search" size={28} color={theme.text.muted} />
            ) : (
              <StandingStone
                size={84}
                color={theme.line.strong}
                carveColor={theme.accent.default}
              />
            )}
            <Txt variant="title" tone="secondary">
              {filtering ? 'Aucune correspondance' : 'Rien d’empilé pour l’instant'}
            </Txt>
            <Txt variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {filtering
                ? 'Essaie d’autres mots, ou retire un filtre.'
                : 'La première pierre se pose avec les boutons en bas.'}
            </Txt>
            {filtering ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSearch('')
                  setTagIds([])
                }}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Txt variant="label" tone="accent">
                  Tout réafficher
                </Txt>
              </Pressable>
            ) : null}
          </Card>
        ) : (
          <MasonryGrid
            items={notes}
            keyExtractor={(n) => n.id}
            estimateHeight={estimateCardHeight}
            /**
             * Pas de poignée pendant la sélection multiple ni sous un filtre.
             *
             * En sélection, les cartes sont des cases à cocher : une poignée y
             * serait une troisième façon de toucher la même carte. Sous un
             * filtre, la grille ne montre qu'une partie des notes, et réordonner
             * une partie ne dit rien de l'ordre du tout — on écrirait des rangs
             * sur une vue incomplète, en déplaçant sans le voir des notes
             * absentes de l'écran.
             */
            onReorder={selectionMode || filtering ? undefined : reorder}
            reorderLabel={(note) => `Déplacer ${displayTitle(note) ?? 'la note'}`}
            renderItem={(note) => (
              <NoteCard
                note={note}
                reserveHandle={!selectionMode && !filtering}
                selectionMode={selectionMode}
                selected={selectedIds.includes(note.id)}
                // En mode sélection, toucher une carte la retient au lieu de
                // l'ouvrir : c'est le comportement attendu, et cela évite d'ouvrir
                // une note par erreur en cochant la suivante.
                onPress={() =>
                  selectionMode ? toggleSelected(note.id) : router.push(`/note/${note.id}`)
                }
                onLongPress={() => toggleSelected(note.id)}
                onTogglePin={() =>
                  updateNote.mutate({ id: note.id, patch: { is_pinned: !note.is_pinned } })
                }
              />
            )}
          />
        )}
      </ScrollView>

      <Composer busy={creating} onCreate={(kind) => void create(kind)} />
    </View>
  )
}

/**
 * Barre d'actions du mode sélection. Elle prend la place du logotype plutôt que
 * de s'ajouter en surplomb : rien ne se décale, et l'écran indique clairement
 * qu'il a changé de mode.
 *
 * La suppression ne demande aucune confirmation, et c'est délibéré : elle envoie à
 * la corbeille, donc elle est réversible. Une boîte de dialogue pour une action
 * annulable est du bruit.
 */
function SelectionBar({
  count,
  allPinned,
  allSelected,
  onSelectAll,
  onCancel,
  onPin,
  onArchive,
  onDelete,
}: {
  count: number
  allPinned: boolean
  allSelected: boolean
  onSelectAll: () => void
  onCancel: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  // Le mode peut être armé sans qu'aucune note ne soit encore retenue : les
  // actions sont alors désactivées plutôt que masquées, pour que la barre ne
  // change pas de forme dès la première case cochée.
  const nothingSelected = count === 0

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48 }}>
      <IconButton icon="x" label="Quitter la sélection" size="md" onPress={onCancel} />
      <Txt variant="label" tone={nothingSelected ? 'muted' : 'primary'} style={{ flex: 1 }}>
        {nothingSelected
          ? 'Toucher des notes'
          : count === 1
            ? '1 sélectionnée'
            : `${count} sélectionnées`}
      </Txt>
      {allSelected ? null : (
        <IconButton
          icon="check-square"
          label="Tout sélectionner"
          size="md"
          onPress={onSelectAll}
        />
      )}
      <IconButton
        icon="bookmark"
        label={allPinned ? 'Désépingler la sélection' : 'Épingler la sélection'}
        size="md"
        active={allPinned && !nothingSelected}
        disabled={nothingSelected}
        onPress={onPin}
      />
      <IconButton
        icon="archive"
        label="Archiver la sélection"
        size="md"
        disabled={nothingSelected}
        onPress={onArchive}
      />
      <IconButton
        icon="trash-2"
        label="Mettre la sélection à la corbeille"
        tone="danger"
        size="md"
        disabled={nothingSelected}
        onPress={onDelete}
      />
    </View>
  )
}

/**
 * Deux boutons de création plutôt qu'un seul suivi d'un choix de type : créer une
 * liste est aussi fréquent que créer une note, l'un ne mérite pas d'être caché
 * derrière l'autre.
 */
function Composer({ busy, onCreate }: { busy: boolean; onCreate: (kind: NoteKind) => void }) {
  return (
    <View
      style={{
        position: 'absolute',
        right: space.lg,
        bottom: space.lg,
        flexDirection: 'row',
        gap: space.sm,
      }}
    >
      <ComposerButton
        icon="check-square"
        label="Nouvelle liste"
        busy={busy}
        onPress={() => onCreate('checklist')}
      />
      <ComposerButton
        icon="plus"
        label="Nouvelle note"
        primary
        busy={busy}
        onPress={() => onCreate('note')}
      />
    </View>
  )
}
