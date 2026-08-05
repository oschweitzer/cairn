import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import {
  useAddChecklistItem,
  useDeleteChecklistItem,
  useReorderChecklistItems,
  useSetNotePrivate,
  useSetNoteTags,
  useTags,
  usePurgeNote,
  useTrashNote,
  useUpdateChecklistItem,
  useUpdateNote,
} from '@/db/queries'
import { isEmptyNote } from '@/db/noteLogic'
import { useNote } from '@/db/select'
import { useVault } from '@/vault/VaultProvider'
import { useTheme } from '@/ui/ThemeProvider'
import { Button, Card, Seam, Txt, noWebOutline } from '@/ui/components'
import { ColorPicker, TagPicker } from '@/ui/pickers'
import { radius, space, type, type TagColorKey } from '@/ui/theme'

/** Délai avant enregistrement, pour ne pas écrire à chaque frappe. */
const AUTOSAVE_MS = 600

type Panel = 'none' | 'color' | 'tags'

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  const note = useNote(id)
  const tagsQuery = useTags()
  const vault = useVault()

  const updateNote = useUpdateNote()
  const trashNote = useTrashNote()
  const purgeNote = usePurgeNote()
  const setNoteTags = useSetNoteTags()
  const setNotePrivate = useSetNotePrivate()
  const addItem = useAddChecklistItem()
  const updateItem = useUpdateChecklistItem()
  const deleteItem = useDeleteChecklistItem()
  const reorder = useReorderChecklistItems()

  const [panel, setPanel] = useState<Panel>('none')
  const [draftItem, setDraftItem] = useState('')

  // État local du texte, pour que la frappe reste fluide sans attendre le
  // réseau. Il n'est réamorcé que si l'on change de note : sans cette garde, une
  // revalidation en arrière-plan écraserait ce que l'utilisateur vient de taper.
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [codeName, setCodeName] = useState('')
  const seededFor = useRef<string | null>(null)

  useEffect(() => {
    if (!note || seededFor.current === note.id) return
    seededFor.current = note.id
    setTitle(note.title ?? '')
    setBody(note.body ?? '')
    setCodeName(note.code_name ?? '')
  }, [note])

  // Enregistrement différé du titre, du corps et du nom de code.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(
    (patch: { title?: string; body?: string; codeName?: string }) => {
      if (!note) return
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        updateNote.mutate({
          id: note.id,
          // Un titre vide vaut « pas de titre » : la contrainte SQL refuse une
          // chaîne blanche, et null est le bon état pour une note sans titre.
          patch: {
            ...(patch.title !== undefined ? { title: patch.title.trim() || null } : {}),
            ...(patch.body !== undefined ? { body: patch.body || null } : {}),
            ...(patch.codeName !== undefined ? { code_name: patch.codeName.trim() || null } : {}),
          },
        })
      }, AUTOSAVE_MS)
    },
    [note, updateNote],
  )

  // Un départ d'écran ne doit pas emporter la dernière frappe avec lui.
  useEffect(() => {
    return () => {
      if (pending.current) clearTimeout(pending.current)
    }
  }, [])

  const flushAndLeave = useCallback(() => {
    if (pending.current) clearTimeout(pending.current)
    if (note) {
      const nextTitle = title.trim() || null
      const nextBody = body || null
      // Le nom de code ne survit pas hors du coffre : la contrainte
      // `code_name_requires_private` le refuse, et l'y écrire ferait échouer
      // l'enregistrement de sortie sans que rien ne l'explique à l'écran.
      const nextCodeName = note.is_private ? codeName.trim() || null : null

      /**
       * Une note restée entièrement vide est écartée en sortant, comme le fait
       * Google Keep. Sans cela chaque ouverture des boutons de création laisse un
       * résidu dans la grille, et une note sans contenu s'y affiche mal.
       *
       * L'emptiness est calculée sur l'état local, pas sur `note` : la note
       * serveur peut être en retard de 600 millisecondes sur la frappe, et
       * supprimer sur cette base effacerait ce que l'utilisateur vient d'écrire.
       *
       * Suppression définitive et non mise à la corbeille : il n'y a rien à
       * récupérer, et remplir la corbeille de coquilles vides n'aide personne.
       */
      if (isEmptyNote({ ...note, title: nextTitle, body: nextBody, code_name: nextCodeName })) {
        purgeNote.mutate(note.id)
        router.back()
        return
      }

      if (nextTitle !== note.title || nextBody !== note.body || nextCodeName !== note.code_name) {
        updateNote.mutate({
          id: note.id,
          patch: { title: nextTitle, body: nextBody, code_name: nextCodeName },
        })
      }
    }
    router.back()
  }, [note, title, body, codeName, updateNote, purgeNote, router])

  if (!note) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retour"
            onPress={() => router.back()}
            style={{ width: 48, height: 48, justifyContent: 'center' }}
          >
            <Feather name="arrow-left" size={22} color={theme.text.primary} />
          </Pressable>
          {/**
           * Deux raisons très différentes de ne pas trouver la note, et il faut
           * les distinguer.
           *
           * Le coffre se referme tout seul au bout de cinq minutes et au passage
           * en arrière-plan. Si une note du coffre était ouverte, elle disparaît
           * sous les yeux de son lecteur : c'est le comportement voulu, le
           * contenu ne doit pas rester à l'écran après la fermeture. Mais
           * annoncer une suppression depuis un autre appareil serait un mensonge
           * inquiétant pour quelque chose de parfaitement normal.
           */}
          {vault.configured && !vault.unlocked ? (
            <Card>
              <Txt variant="title">Le coffre s’est refermé</Txt>
              <Txt variant="body" tone="secondary">
                Cette note y est peut-être rangée. Rouvre le coffre pour la retrouver.
              </Txt>
              <Button label="Ouvrir le coffre" onPress={() => router.replace('/vault')} />
            </Card>
          ) : (
            <Card>
              <Txt variant="title">Note introuvable</Txt>
              <Txt variant="body" tone="secondary">
                Elle a peut-être été supprimée depuis un autre appareil.
              </Txt>
            </Card>
          )}
        </View>
      </View>
    )
  }

  const selectedTagIds = note.tags.map((t) => t.id)

  /**
   * Entrée et sortie du coffre.
   *
   * Le coffre doit être ouvert pour y ranger quoi que ce soit, et ce n'est pas
   * une formalité de sécurité : une note masquée pendant que le coffre est fermé
   * disparaîtrait de la liste visible sans réapparaître nulle part, et l'éditeur
   * ouvert dessus afficherait « note introuvable » dans la seconde. On envoie
   * donc d'abord vers le coffre, la note reste où elle est.
   */
  function toggleVault() {
    if (!note) return
    if (!note.is_private && (!vault.configured || !vault.unlocked)) {
      router.push('/vault')
      return
    }
    setNotePrivate.mutate({
      id: note.id,
      isPrivate: !note.is_private,
      codeName: note.is_private ? null : codeName,
    })
  }

  function moveItem(index: number, direction: -1 | 1) {
    const ordered = [...note!.items]
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    reorder.mutate({ noteId: note!.id, orderedIds: ordered.map((i) => i.id) })
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
      {/* Barre d'actions */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.sm,
          paddingBottom: space.xs,
        }}
      >
        <IconButton icon="arrow-left" label="Retour" onPress={flushAndLeave} />
        <View style={{ flex: 1 }} />
        <IconButton
          icon={note.kind === 'checklist' ? 'align-left' : 'check-square'}
          label={note.kind === 'checklist' ? 'Convertir en note' : 'Convertir en liste'}
          onPress={() =>
            updateNote.mutate({
              id: note.id,
              patch: { kind: note.kind === 'checklist' ? 'note' : 'checklist' },
            })
          }
        />
        <IconButton
          icon="bookmark"
          label={note.is_pinned ? 'Désépingler' : 'Épingler'}
          active={note.is_pinned}
          onPress={() => updateNote.mutate({ id: note.id, patch: { is_pinned: !note.is_pinned } })}
        />
        <IconButton
          icon={note.is_private ? 'eye-off' : 'eye'}
          label={note.is_private ? 'Sortir du coffre' : 'Ranger dans le coffre'}
          active={note.is_private}
          onPress={toggleVault}
        />
        <IconButton
          icon="archive"
          label={note.is_archived ? 'Désarchiver' : 'Archiver'}
          active={note.is_archived}
          onPress={() => {
            updateNote.mutate({ id: note.id, patch: { is_archived: !note.is_archived } })
            router.back()
          }}
        />
        <IconButton
          icon="trash-2"
          label="Mettre à la corbeille"
          tone="danger"
          onPress={() => {
            trashNote.mutate(note.id)
            router.back()
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={title}
          onChangeText={(next) => {
            setTitle(next)
            scheduleSave({ title: next })
          }}
          placeholder="Titre"
          placeholderTextColor={theme.text.muted}
          style={[
            {
              color: theme.text.primary,
              fontFamily: type.title.fontFamily,
              fontSize: 22,
              lineHeight: 30,
              paddingVertical: space.xs,
            },
            noWebOutline,
          ]}
        />

        {/**
         * Nom de code, uniquement sur une note du coffre.
         *
         * C'est lui, et lui seul, qui s'affiche dans la grille du coffre. Sans
         * nom de code la carte reste muette : le titre n'est pas montré en
         * repli, ce serait exactement la fuite que le coffre doit empêcher.
         * D'où l'indication sous le champ plutôt qu'un simple libellé.
         */}
        {note.is_private ? (
          <View style={{ gap: space.xxs }}>
            <TextInput
              value={codeName}
              onChangeText={(next) => {
                setCodeName(next)
                scheduleSave({ codeName: next })
              }}
              placeholder="Nom de code"
              placeholderTextColor={theme.text.muted}
              style={[
                {
                  color: theme.accent.default,
                  fontFamily: type.label.fontFamily,
                  fontSize: type.label.fontSize,
                  minHeight: 40,
                  paddingHorizontal: space.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: theme.line.hairline,
                  backgroundColor: theme.surface.recessed,
                },
                noWebOutline,
              ]}
            />
            <Txt variant="caption" tone="muted">
              {codeName.trim()
                ? 'C’est ce nom qui s’affiche dans le coffre, à la place du titre.'
                : 'Sans nom de code, cette note n’affiche aucun titre dans le coffre.'}
            </Txt>
          </View>
        ) : null}

        {/* Le titre est séparé du corps par un trait de partage gravé, comme sur
            une pierre où l'en-tête n'est pas dans la même travée que le texte.
            Dagaz est choisie pour sa forme symétrique : elle se lit comme un
            ornement, pas comme une lettre qu'il faudrait déchiffrer. */}
        <Seam mark="dagaz" />

        {note.kind === 'note' ? (
          <TextInput
            value={body}
            onChangeText={(next) => {
              setBody(next)
              scheduleSave({ body: next })
            }}
            placeholder="Écrire."
            placeholderTextColor={theme.text.muted}
            multiline
            textAlignVertical="top"
            style={[
              {
                color: theme.text.primary,
                fontFamily: type.body.fontFamily,
                fontSize: type.body.fontSize,
                lineHeight: type.body.lineHeight,
                minHeight: 220,
              },
              noWebOutline,
            ]}
          />
        ) : (
          <View style={{ gap: space.xs }}>
            {note.items.map((item, index) => (
              <View
                key={item.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.is_done }}
                  accessibilityLabel={item.content}
                  onPress={() =>
                    updateItem.mutate({ id: item.id, patch: { is_done: !item.is_done } })
                  }
                  hitSlop={space.sm}
                  style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: item.is_done ? theme.accent.default : theme.line.strong,
                      backgroundColor: item.is_done ? theme.accent.default : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {item.is_done ? (
                      <Feather name="check" size={13} color={theme.text.onAccent} />
                    ) : null}
                  </View>
                </Pressable>

                <TextInput
                  defaultValue={item.content}
                  onEndEditing={(e) => {
                    const next = e.nativeEvent.text.trim()
                    if (next && next !== item.content) {
                      updateItem.mutate({ id: item.id, patch: { content: next } })
                    }
                  }}
                  style={[
                    {
                      flex: 1,
                      minHeight: 44,
                      color: item.is_done ? theme.text.muted : theme.text.primary,
                      textDecorationLine: item.is_done ? 'line-through' : 'none',
                      fontFamily: type.body.fontFamily,
                      fontSize: type.body.fontSize,
                    },
                    noWebOutline,
                  ]}
                />

                <IconButton
                  icon="chevron-up"
                  label="Monter"
                  disabled={index === 0}
                  onPress={() => moveItem(index, -1)}
                  compact
                />
                <IconButton
                  icon="chevron-down"
                  label="Descendre"
                  disabled={index === note.items.length - 1}
                  onPress={() => moveItem(index, 1)}
                  compact
                />
                <IconButton
                  icon="x"
                  label={`Supprimer ${item.content}`}
                  onPress={() => deleteItem.mutate(item.id)}
                  compact
                />
              </View>
            ))}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 40, alignItems: 'center' }}>
                <Feather name="plus" size={18} color={theme.text.muted} />
              </View>
              <TextInput
                value={draftItem}
                onChangeText={setDraftItem}
                placeholder="Ajouter un élément"
                placeholderTextColor={theme.text.muted}
                returnKeyType="done"
                // blurOnSubmit désactivé : on enchaîne les éléments sans avoir à
                // recliquer dans le champ à chaque fois.
                blurOnSubmit={false}
                onSubmitEditing={() => {
                  const content = draftItem.trim()
                  if (!content) return
                  addItem.mutate({
                    noteId: note.id,
                    content,
                    position: note.items.length,
                  })
                  setDraftItem('')
                }}
                style={[
                  {
                    flex: 1,
                    minHeight: 44,
                    color: theme.text.primary,
                    fontFamily: type.body.fontFamily,
                    fontSize: type.body.fontSize,
                  },
                  noWebOutline,
                ]}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Panneaux d'attributs, en bas, dépliés à la demande. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.line.hairline,
          backgroundColor: theme.surface.card,
          paddingBottom: insets.bottom,
        }}
      >
        {panel === 'color' ? (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
            <ColorPicker
              value={note.color_key}
              onChange={(next: TagColorKey | null) =>
                updateNote.mutate({ id: note.id, patch: { color_key: next } })
              }
            />
          </View>
        ) : null}

        {panel === 'tags' ? (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.md }}>
            <TagPicker
              tags={tagsQuery.data ?? []}
              selectedIds={selectedTagIds}
              emptyHint="Aucun tag pour l’instant. Ils se créent dans l’onglet Tags."
              onToggle={(tagId) => {
                const next = selectedTagIds.includes(tagId)
                  ? selectedTagIds.filter((t) => t !== tagId)
                  : [...selectedTagIds, tagId]
                setNoteTags.mutate({ noteId: note.id, tagIds: next })
              }}
            />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', paddingHorizontal: space.sm, paddingVertical: space.xs }}>
          <IconButton
            icon="droplet"
            label="Couleur"
            active={panel === 'color'}
            onPress={() => setPanel(panel === 'color' ? 'none' : 'color')}
          />
          <IconButton
            icon="tag"
            label="Tags"
            active={panel === 'tags'}
            onPress={() => setPanel(panel === 'tags' ? 'none' : 'tags')}
          />
          <View style={{ flex: 1 }} />
          {note.tags.length > 0 ? (
            <View style={{ justifyContent: 'center', paddingRight: space.sm }}>
              <Txt variant="caption" tone="muted">
                {note.tags.map((t) => t.name).join(', ')}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
  compact = false,
  tone = 'default',
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
  compact?: boolean
  tone?: 'default' | 'danger'
}) {
  const { theme } = useTheme()
  const size = compact ? 36 : 48
  const color = disabled
    ? theme.text.muted
    : tone === 'danger'
      ? theme.state.danger
      : active
        ? theme.accent.default
        : theme.text.secondary

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      // hitSlop porte la zone tactile réelle à 48 même sur la variante compacte,
      // où seul le glyphe est réduit.
      hitSlop={compact ? 6 : 0}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: active ? theme.accent.subtle : 'transparent',
      }}
    >
      <Feather name={icon} size={compact ? 16 : 20} color={color} />
    </Pressable>
  )
}
