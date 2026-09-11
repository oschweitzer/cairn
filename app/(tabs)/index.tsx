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
import { describeDbError } from '@/db/errors'
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

  // A failure named rather than quoted: see src/db/errors.ts.
  const failure = isError ? describeDbError(error) : null

  const [creating, setCreating] = useState(false)
  const searchFocus = useFocusRing()
  const filtering = search.trim().length > 0 || tagIds.length > 0

  // Multiple selection. The mode turns on as soon as a note is picked, and ends
  // by itself when the last one is deselected: no "leave" button to find, and no
  // way to get stuck in an empty mode.
  const [rawSelectedIds, setRawSelectedIds] = useState<string[]>([])
  /**
   * Mode explicitly armed, regardless of what is already picked.
   *
   * A long press is enough for a finger but is hard to discover with a mouse,
   * where holding the button for 350 milliseconds is not a gesture anyone tries
   * spontaneously. A dedicated button makes entering the mode visible on both
   * surfaces, and lets selection be armed before the first note is chosen.
   */
  const [selectionArmed, setSelectionArmed] = useState(false)
  const trashNotes = useTrashNotes()
  const setNotesArchived = useSetNotesArchived()
  const setNotesPinned = useSetNotesPinned()

  /**
   * The effective selection is derived, never pruned in state.
   *
   * A note picked and then filtered out of view by a search would otherwise stay
   * invisibly selected, and a bulk action would touch it with nothing announcing
   * it. Deriving it on every render solves the problem without calling setState
   * during render, which would loop.
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

  // After a bulk action, the selection has no purpose left: the targeted notes
  // have changed state or left the view.
  const runOnSelection = useCallback(
    (action: (ids: string[]) => void) => {
      action(selectedIds)
      clearSelection()
    },
    [selectedIds, clearSelection],
  )

  const selectedNotes = notes.filter((n) => selectedIds.includes(n.id))
  // A batch that is already entirely pinned offers unpinning, not the reverse.
  const allPinned = selectionMode && selectedNotes.every((n) => n.is_pinned)

  /**
   * Dropping one card on another: the note takes its target's place.
   *
   * The decision is in `moveNote`, where it is tested — that is where the
   * pinned-first rule lives, and an ordering rule is far easier to check on an
   * array than on a screen.
   *
   * The complete order is sent back to the server, not just the two notes that
   * moved: moving a card shifts every card after it, and writing only the ends
   * would leave duplicate ranks.
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
          // Room under the grid so the create buttons never cover the last
          // card.
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

        {/* Instant search over the cache: no latency per keystroke, and it keeps
            working offline. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 48,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            // The focus ring is redone in aurora: the browser's default blue has
            // no place in this palette, but keyboard navigation must stay
            // visible.
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

        {/* A revalidation that fails while the cache holds notes must not empty
            the screen: offline, the content already loaded is still the best
            thing to show. The error then shows as a banner, and only takes the
            whole space if there is really nothing to display. */}
        {failure && notes.length > 0 ? (
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
            {/* The crossed-out antenna only suits a network failure. It promised
                the content back at the next connection, which a database that
                is behind will never deliver. */}
            <Feather
              name={failure.kind === 'network' ? 'wifi-off' : 'alert-triangle'}
              size={14}
              color={theme.state.danger}
            />
            <Txt variant="caption" tone="danger" style={{ flex: 1 }}>
              {failure.kind === 'network'
                ? 'Contenu affiché depuis le cache, la synchronisation a échoué.'
                : `Contenu affiché depuis le cache : ${failure.title.toLocaleLowerCase('fr')}.`}
            </Txt>
          </View>
        ) : null}

        {failure && notes.length === 0 ? (
          <Card style={{ gap: space.sm }}>
            <Txt variant="title" tone="danger">
              {failure.title}
            </Txt>
            <Txt variant="body" tone="secondary">
              {failure.message}
            </Txt>
            {/* The raw message stays on screen, below and smaller: it is the
                line people copy into a bug report. */}
            {failure.detail ? (
              <Txt variant="caption" tone="muted">
                {failure.detail}
              </Txt>
            ) : null}
          </Card>
        ) : isLoading ? (
          <RuneLoader message="On dépile les pierres…" />
        ) : notes.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.md }}>
            {/**
             * Two very different kinds of empty, two different images. A filter
             * with no result is a search problem, so the magnifier icon is the
             * right answer. A truly empty space is an invitation to lay the
             * first stone: that is the standing stone, not a pictogram.
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
             * No handle during multiple selection or under a filter.
             *
             * In selection, the cards are checkboxes: a handle there would be a
             * third way to touch the same card. Under a filter, the grid only
             * shows part of the notes, and reordering a part says nothing about
             * the order of the whole — we would write ranks on an incomplete
             * view, moving notes that are not on screen without seeing it.
             */
            onReorder={selectionMode || filtering ? undefined : reorder}
            reorderLabel={(note) => `Déplacer ${displayTitle(note) ?? 'la note'}`}
            renderItem={(note) => (
              <NoteCard
                note={note}
                reserveHandle={!selectionMode && !filtering}
                selectionMode={selectionMode}
                selected={selectedIds.includes(note.id)}
                // In selection mode, touching a card picks it instead of opening
                // it: that is the expected behaviour, and it avoids opening a
                // note by mistake while ticking the next one.
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
 * Selection mode action bar. It takes the logotype's place rather than being
 * added on top: nothing shifts, and the screen clearly shows it has changed
 * mode.
 *
 * Deleting asks for no confirmation, and that is deliberate: it sends to the
 * trash, so it can be undone. A dialog for an undoable action is noise.
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
  // The mode can be armed before any note is picked: the actions are then
  // disabled rather than hidden, so the bar does not change shape at the first
  // box ticked.
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
 * Two create buttons rather than one followed by a choice of type: creating a
 * list is as frequent as creating a note, and neither deserves to be hidden
 * behind the other.
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
