import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native'
import Animated from 'react-native-reanimated'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Feather from '@expo/vector-icons/Feather'
import {
  useAddChecklistItem,
  useCreateTag,
  useDeleteChecklistItem,
  useReorderChecklistItems,
  useSetNotePrivate,
  useSetNoteTag,
  useTags,
  usePurgeNote,
  useTrashNote,
  useUpdateChecklistItem,
  useUpdateNote,
} from '@/db/queries'
import {
  colorAfterTagChange,
  copyableText,
  findTagNamed,
  isEmptyNote,
  nextTagColor,
} from '@/db/noteLogic'
import type { Tag } from '@/db/types'
import { useNote } from '@/db/select'
import { applyFormat, insertLink, linkAt, type Format, type Selection } from '@/text/markup'
import { useGoBack } from '@/nav/back'
import { useVault } from '@/vault/VaultProvider'
import { useTheme } from '@/ui/ThemeProvider'
import { Button, Card, Seam, Txt, noWebOutline } from '@/ui/components'
import { FormatBar } from '@/ui/FormatBar'
import { IconButton } from '@/ui/IconButton'
import { useKeyboardOpen } from '@/ui/keyboard'
import { RichText } from '@/ui/RichText'
import { ColorPicker, TagPicker } from '@/ui/pickers'
import { AgendaBouton, AgendaPanel } from '@/ui/AgendaPanel'
import { RuneLoader } from '@/ui/RuneLoader'
import { useToast } from '@/ui/Toast'
import { appear, reflow, useRise, vanish } from '@/ui/transitions'
import { radius, space, tagColorKeys, type, type TagColorKey } from '@/ui/theme'

/** Delay before saving, so as not to write on every keystroke. */
const AUTOSAVE_MS = 600

type Panel = 'none' | 'color' | 'tags' | 'agenda' | 'format'

/**
 * The field the formatting applies to.
 *
 * The bar knows no field: it names a gesture, and the screen knows where to
 * carry it. Without this target, the same button would have to exist twice — one
 * for the body, one for the list item being edited — and disable itself
 * depending on focus, which would make the bar flicker at every change of field.
 */
type Cible = { kind: 'body' } | { kind: 'item'; id: string }

function memeChamp(a: Cible | null, b: Cible): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind === 'body' || a.id === (b as { id: string }).id
}

/** A text field seen from the web, where the ref is the DOM node. */
type ChampWeb = HTMLTextAreaElement | HTMLInputElement

const ECOUTEURS = new WeakMap<ChampWeb, EventListener>()

/** The DOM node behind a field, on the web only. */
function champWeb(champ: TextInput | null): ChampWeb | null {
  if (Platform.OS !== 'web' || !champ) return null
  const noeud = champ as unknown as ChampWeb
  return typeof noeud.addEventListener === 'function' ? noeud : null
}

/**
 * Makes Cmd or Ctrl + click on an address, inside the field, open it.
 *
 * Web only, and through a DOM listener rather than a `TextInput` prop, which
 * does not expose the click. There is no cleaner way: a multiline field becomes
 * a `textarea`, and a `textarea` holds nothing but plain text — no anchor, no
 * styled fragment. So we read where the browser has just put the caret, and look
 * for an address at that spot.
 *
 * No long-press equivalent on Android: that gesture belongs to the system's
 * selection menu in a text field, and taking it back would cost copy and paste.
 * The « Ouvrir » bar covers it there, and everywhere else.
 */
function poseOuvreLien(champ: TextInput | null) {
  const el = champWeb(champ)
  if (!el || ECOUTEURS.has(el)) return
  // `EventListener` and not `(e: MouseEvent) => void`: on a union of element
  // types, TypeScript no longer picks the typed overload of
  // `addEventListener`. So the narrowing happens here, once.
  const surClic: EventListener = (evenement) => {
    const e = evenement as MouseEvent
    // Cmd on macOS, Ctrl elsewhere. Both are accepted because they do not step
    // on each other: on macOS, Ctrl + click *is* a right click, which fires
    // `mousedown` then `contextmenu` without ever firing `click`. The `ctrlKey`
    // branch is therefore never reached there, and steals no menu. Observed in
    // a browser, not assumed.
    if (!e.metaKey && !e.ctrlKey) return
    const lien = linkAt(el.value ?? '', el.selectionStart ?? 0)
    if (!lien) return
    // The click has already placed the caret, which is what we want; we only
    // cancel what follows, so that nothing else reacts.
    e.preventDefault()
    void Linking.openURL(lien.href)
  }
  el.addEventListener('click', surClic)
  ECOUTEURS.set(el, surClic)
}

function retireOuvreLien(champ: TextInput | null) {
  const el = champWeb(champ)
  const surClic = el ? ECOUTEURS.get(el) : undefined
  if (!el || !surClic) return
  el.removeEventListener('click', surClic)
  ECOUTEURS.delete(el)
}

/**
 * Whether list items wrap onto several lines while being written.
 *
 * A single-line field scrolls sideways once its text outruns the row, and on a
 * phone the row leaves the text barely half the screen: the start of the item
 * slid out of view, and reading it back meant scrolling one character at a time.
 * A multiline field grows with its text instead.
 *
 * Native only. react-native-web ignores `submitBehavior`, and a multiline field
 * there is a `textarea` that does not grow by itself, where return would insert a
 * line break instead of adding the item. A desktop row is wide enough anyway.
 */
const ITEMS_WRAP = Platform.OS !== 'web'

/**
 * An item is one paragraph. Return no longer types a line break once the field
 * is multiline, but a pasted text can still carry some: they become spaces.
 */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ')
}

/**
 * Vertical padding that makes one line of body text a 44-point row, the height
 * of the checkbox beside it. Padding rather than `minHeight` alone: a multiline
 * field puts its text at the top, and the first line has to sit level with the
 * checkbox, whatever the number of lines below it.
 */
const ITEM_PADDING = (44 - type.body.lineHeight) / 2

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const goBack = useGoBack()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardOpen = useKeyboardOpen()

  const { note, isLoading } = useNote(id)
  const tagsQuery = useTags()
  const vault = useVault()
  const { markActivity } = vault
  const toast = useToast()

  const updateNote = useUpdateNote()
  const trashNote = useTrashNote()
  const purgeNote = usePurgeNote()
  const setNoteTag = useSetNoteTag()
  const createTag = useCreateTag()
  const setNotePrivate = useSetNotePrivate()
  const addItem = useAddChecklistItem()
  const updateItem = useUpdateChecklistItem()
  const deleteItem = useDeleteChecklistItem()
  const reorder = useReorderChecklistItems()

  /**
   * Does the note live in the encrypted vault? The mutations cannot guess: all
   * they receive is an id. So the editor says it, on every write that touches
   * the text.
   */
  const encrypted = Boolean(note?.is_private)

  const [panel, setPanel] = useState<Panel>('none')
  const [draftItem, setDraftItem] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const rising = useRise()

  /**
   * Reading or writing.
   *
   * A text field cannot display formatted text: on the web it becomes a
   * `textarea`, which accepts plain text only. So there have to be two views of
   * the same content, and a button to switch between them — the usual bargain of
   * markup editors, and an honest one: you see the markup while writing, the
   * result while reading.
   *
   * Reading is also the only view where a link can be clicked: in a text field,
   * a tap places a caret.
   */
  const [reading, setReading] = useState(false)

  /**
   * The field targeted by the format bar, and the range selected in it. Both
   * live here and not in the fields: the bar is elsewhere in the tree, and the
   * screen is what connects them.
   */
  const [cible, setCible] = useState<Cible | null>(null)
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 })

  /**
   * Selection to force on the next render, and never again.
   *
   * After formatting, the caret has to land between the marks just added,
   * otherwise it jumps to the end of the field and you have to click again to
   * keep writing. The only way to move it is the `selection` prop, but leaving
   * it set would freeze the caret on every keystroke: so it is dropped as soon as
   * the field has reported where it stands.
   */
  const [selectionImposee, setSelectionImposee] = useState<Selection | null>(null)

  /**
   * Text of the list items being edited.
   *
   * The fields used to be uncontrolled — `defaultValue` and a write on leaving —
   * which was enough as long as nothing but typing changed them. The format bar,
   * though, rewrites the content from outside: without a controlled value, the
   * field would keep the previous text on screen.
   */
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})

  // Local state for the text, so typing stays smooth without waiting on the
  // network. It is only reseeded when the note changes: without that guard, a
  // background revalidation would overwrite what the user has just typed.
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

  // Deferred save of the title, the body and the code name.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback(
    (patch: { title?: string; body?: string; codeName?: string }) => {
      if (!note) return
      // Typing is a gesture, even when no finger touches the screen: on a phone
      // the keys belong to the system keyboard, which the vault does not see go
      // by. See `markActivity`.
      markActivity()
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        updateNote.mutate({
          id: note.id,
          encrypted,
          current: { title: note.title, body: note.body },
          // An empty title means "no title": the SQL constraint rejects a blank
          // string, and null is the right state for an untitled note.
          patch: {
            ...(patch.title !== undefined ? { title: patch.title.trim() || null } : {}),
            ...(patch.body !== undefined ? { body: patch.body || null } : {}),
            ...(patch.codeName !== undefined ? { code_name: patch.codeName.trim() || null } : {}),
          },
        })
      }, AUTOSAVE_MS)
    },
    [note, updateNote, encrypted, markActivity],
  )

  // Leaving the screen must not take the last keystroke with it.
  useEffect(() => {
    return () => {
      if (pending.current) clearTimeout(pending.current)
    }
  }, [])

  /**
   * Writes whatever was waiting, right away, without announcing anything.
   *
   * Kept apart from the acknowledgement because two callers have different
   * needs: the save button wants a word to display, the detour through the vault
   * only wants the pending typing written before leaving the screen.
   */
  const flushEdits = useCallback(async (): Promise<
    'empty' | 'unchanged' | 'saved' | 'failed'
  > => {
    if (!note) return 'unchanged'
    if (pending.current) {
      clearTimeout(pending.current)
      pending.current = null
    }

    const nextTitle = title.trim() || null
    const nextBody = body || null
    const nextCodeName = note.is_private ? codeName.trim() || null : null

    // An empty note is not saved: it would be discarded on leaving the editor,
    // and claiming otherwise would be a lie that lasts a minute.
    if (isEmptyNote({ ...note, title: nextTitle, body: nextBody, code_name: nextCodeName })) {
      return 'empty'
    }

    if (nextTitle === note.title && nextBody === note.body && nextCodeName === note.code_name) {
      return 'unchanged'
    }

    try {
      await updateNote.mutateAsync({
        id: note.id,
        encrypted,
        current: { title: nextTitle, body: nextBody },
        patch: { title: nextTitle, body: nextBody, code_name: nextCodeName },
      })
      return 'saved'
    } catch {
      return 'failed'
    }
  }, [note, title, body, codeName, updateNote, encrypted])

  /**
   * Save on demand.
   *
   * The deferred save already does the work, and the button is not there to
   * replace it: it is there because an invisible save reassures nobody. Writing
   * a long text without ever seeing the slightest sign that it is safe is
   * uncomfortable, and doubt drives fallback gestures, like copying the note
   * somewhere else.
   *
   * Hence an answer every time, including when there was nothing to write: a
   * button that says nothing one time out of two brings back exactly the doubt
   * it was meant to remove.
   */
  const saveNow = useCallback(async () => {
    switch (await flushEdits()) {
      case 'empty':
        toast('Rien à enregistrer, la note est vide.')
        break
      case 'unchanged':
        toast('Déjà enregistrée.', { tone: 'success' })
        break
      case 'saved':
        toast('Note enregistrée.', { tone: 'success' })
        break
      case 'failed':
        // The typed text stays in local state, so on screen: the failure costs
        // nothing as long as the note is not left, and that is what to say
        // rather than parroting a network error.
        toast('Enregistrement impossible, le texte reste à l’écran.', { tone: 'danger' })
        break
    }
  }, [flushEdits, toast])

  /**
   * Brings the add field back into view, at the bottom of the scroll.
   *
   * The screen already shrinks in front of the keyboard, but that is not enough
   * for a list: the field is the last line of the content, and each added item
   * pushes the content further down the visible area. Ten items in a row would
   * push it out through the bottom with nothing having scrolled it there.
   *
   * After the render and not during it: the item that has just arrived must
   * have taken its place for "the end" to be the right one. Hence waiting a frame.
   */
  const scroller = useRef<ScrollView | null>(null)
  const keepDraftInView = useCallback(() => {
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }))
  }, [])

  /**
   * Adding a list item.
   *
   * Failure used to be silent: the field emptied, no item appeared, and nothing
   * told a lost write from a button that does not work. So the text is handed
   * back to the field if the write fails, rather than lost.
   */
  const addDraftItem = useCallback(() => {
    if (!note) return
    const content = draftItem.trim()
    if (!content) return
    setDraftItem('')
    addItem.mutate(
      { noteId: note.id, content, position: note.items.length, encrypted },
      {
        onSuccess: () => keepDraftInView(),
        onError: () => {
          setDraftItem((current) => (current ? current : content))
          toast('Élément non ajouté, le texte est revenu dans le champ.', { tone: 'danger' })
        },
      },
    )
  }, [note, draftItem, addItem, toast, encrypted, keepDraftInView])

  /** Displayed text of an item: the draft if there is one, otherwise the database. */
  const itemText = useCallback(
    (id: string, fallback: string) => itemDrafts[id] ?? fallback,
    [itemDrafts],
  )

  /**
   * The content in the clipboard, to be pasted into a message.
   *
   * What is copied is what is on screen, not what the database holds: the body
   * comes from local state and the items from their drafts, so the last
   * keystroke travels even when the deferred save has not fired yet. Copying a
   * version six hundred milliseconds old would be a bug nobody would think to
   * look for.
   *
   * A note from the vault is copied like any other: it is readable on screen,
   * and refusing to copy what can be read would be theatre. Worth knowing all
   * the same — the system clipboard belongs to every app, so this is the one
   * place where the vault's content leaves it, at the user's own request.
   */
  const copyContent = useCallback(async () => {
    if (!note) return
    markActivity()
    const text = copyableText({
      kind: note.kind,
      body,
      items: note.items.map((item) => ({
        content: itemText(item.id, item.content),
        is_done: item.is_done,
      })),
    })
    // Nothing to copy leaves the clipboard alone: overwriting what was in it
    // with an empty string would destroy something the user had put there.
    if (!text) {
      toast('Rien à copier.')
      return
    }
    try {
      await Clipboard.setStringAsync(text)
      toast('Contenu copié.', { tone: 'success' })
    } catch {
      toast('Copie impossible, rien n’a été mis dans le presse-papier.', { tone: 'danger' })
    }
  }, [note, body, itemText, markActivity, toast])

  /**
   * Text fields, by target, so focus can be given back to them.
   *
   * Pressing a button of the format bar leaves the field — that is what a click
   * on a button does, on the web as elsewhere. The browser then collapses the
   * selection, and the caret position computed by the command has nothing left
   * to apply to: you ended up at the start of the text, having to click again
   * between every mark.
   */
  const champs = useRef(new Map<string, TextInput | null>()).current
  const cleChamp = (pour: Cible) => (pour.kind === 'body' ? 'body' : `item:${pour.id}`)

  /**
   * Writes formatted text into the targeted field, and puts the caret back in it.
   *
   * One path for both kinds of field, because the difference between a note
   * body and a list item lies in where you write, not in what you write. The
   * item goes to the database right away: unlike the body, it has no deferred
   * save, and waiting for the field to be left would lose the formatting if the
   * screen is left in the meantime.
   */
  const ecrire = useCallback(
    (edit: { text: string; selection: Selection }) => {
      if (!cible || !note) return
      if (cible.kind === 'body') {
        setBody(edit.text)
        scheduleSave({ body: edit.text })
      } else {
        setItemDrafts((current) => ({ ...current, [cible.id]: edit.text }))
        updateItem.mutate({ id: cible.id, patch: { content: edit.text }, encrypted })
      }
      setSelection(edit.selection)

      /**
       * Focus first, selection second, and in that order.
       *
       * The `selection` prop only takes on a field that has focus, and the field
       * has just lost it to the button that was pressed. Forcing it before would
       * do nothing, and the caret would go back to the start of the text — you
       * had to click in the field again between every mark.
       *
       * The object is recreated on purpose: the forced selection is only picked
       * up when the prop changes, and it may already hold that very value.
       */
      const cle = cleChamp(cible)
      setTimeout(() => {
        champs.get(cle)?.focus()
        setSelectionImposee({ ...edit.selection })
      }, 0)
    },
    [cible, note, scheduleSave, updateItem, encrypted, champs],
  )

  const texteCible = useCallback((): string | null => {
    if (!cible) return null
    if (cible.kind === 'body') return body
    const item = note?.items.find((i) => i.id === cible.id)
    return item ? itemText(item.id, item.content) : null
  }, [cible, body, note, itemText])

  const runFormat = useCallback(
    (format: Format) => {
      const texte = texteCible()
      if (texte === null) return
      ecrire(applyFormat(texte, selection, format))
    },
    [texteCible, selection, ecrire],
  )

  const runLink = useCallback(() => {
    const texte = texteCible()
    if (texte === null) return
    ecrire(insertLink(texte, selection))
  }, [texteCible, selection, ecrire])

  /**
   * The address the caret sits in, if there is one.
   *
   * This is what stands in for a clickable link while writing, since none can
   * be placed in a text field. So the bar only appears when it has something to
   * open, and goes away as soon as the caret leaves — it does not have to be
   * looked for, it shows up at the right moment.
   *
   * Nothing in reading mode: links are already clickable there, and one more bar
   * would only say what is already in plain sight.
   */
  const lienSousCurseur = useMemo(
    () => (reading ? null : linkAt(texteCible() ?? '', selection.start)),
    [reading, texteCible, selection.start],
  )

  /**
   * Handlers shared by every field the bar can format.
   *
   * `onSelectionChange` serves two ends: tracking what is selected, and
   * releasing the forced selection once it has taken. Without the second, the
   * caret would stay stuck where the last command had put it.
   */
  const champFormatable = useCallback(
    (pour: Cible) => ({
      ref: (champ: TextInput | null) => {
        const cle = cleChamp(pour)
        retireOuvreLien(champs.get(cle) ?? null)
        champs.set(cle, champ)
        poseOuvreLien(champ)
      },
      onFocus: () => setCible(pour),
      selection: selectionImposee && memeChamp(cible, pour) ? selectionImposee : undefined,
      onSelectionChange: (e: { nativeEvent: { selection: Selection } }) => {
        setCible(pour)
        setSelection(e.nativeEvent.selection)
        setSelectionImposee(null)
      },
    }),
    [cible, selectionImposee, champs],
  )

  const flushAndLeave = useCallback(() => {
    if (pending.current) clearTimeout(pending.current)
    if (note) {
      const nextTitle = title.trim() || null
      const nextBody = body || null
      // The code name does not survive outside the vault: the
      // `code_name_requires_private` constraint rejects it, and writing it would
      // fail the save on leaving with nothing on screen to explain why.
      const nextCodeName = note.is_private ? codeName.trim() || null : null

      /**
       * A note left entirely empty is discarded on leaving, as Google Keep
       * does. Otherwise every use of the create buttons leaves a residue in the
       * grid, and a note with no content displays badly there.
       *
       * Emptiness is computed on local state, not on `note`: the server note can
       * lag 600 milliseconds behind typing, and deleting on that basis would
       * erase what the user has just written.
       *
       * Permanent deletion rather than the trash: there is nothing to recover,
       * and filling the trash with empty shells helps nobody.
       */
      if (isEmptyNote({ ...note, title: nextTitle, body: nextBody, code_name: nextCodeName })) {
        purgeNote.mutate(note.id)
        goBack()
        return
      }

      if (nextTitle !== note.title || nextBody !== note.body || nextCodeName !== note.code_name) {
        updateNote.mutate({
          id: note.id,
          encrypted,
          current: { title: nextTitle, body: nextBody },
          patch: { title: nextTitle, body: nextBody, code_name: nextCodeName },
        })
      }
    }
    goBack()
  }, [note, title, body, codeName, updateNote, purgeNote, router, encrypted])

  if (!note) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <IconButton icon="arrow-left" label="Retour" onPress={() => goBack()} />
          {/**
           * Three very different reasons for not finding the note, and they
           * have to be told apart.
           *
           * The first is not one: the lookup has not finished. Opening a note
           * cold, or reloading the page on the web, lands here before the query
           * answers. Announcing a disappearance at that moment gets it backwards,
           * and that is what this screen used to do.
           *
           * The vault closes by itself after five minutes without a gesture. If
           * a vault note was open, it vanishes before its reader's eyes: that is
           * the intended behaviour, content must not stay on screen after the
           * vault closes. But announcing a deletion from another device would be
           * an alarming lie about something perfectly normal.
           */}
          {isLoading ? (
            <RuneLoader message="On déterre la note…" />
          ) : vault.configured && !vault.unlocked ? (
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
   * Typing waiting to be written. The save button lights up as long as something
   * is left to write, and goes dark as soon as it is done: the button's state
   * becomes the permanent indicator the deferred save lacked, without adding one
   * more word to the screen.
   */
  const unsaved =
    (title.trim() || null) !== note.title ||
    (body || null) !== note.body ||
    (note.is_private ? codeName.trim() || null : null) !== note.code_name

  /**
   * Moving into and out of the vault.
   *
   * The vault has to be open to put anything in it, and that is not a security
   * formality: a note hidden while the vault is closed would vanish from the
   * visible list without reappearing anywhere, and the editor open on it would
   * show « note introuvable » within the second. So we send to the vault first,
   * and the note stays where it is.
   *
   * ── The intent travels with the navigation ───────────────────────────────────
   * The detour carries the note's id, and the vault files the note itself as it
   * opens. Without that the gesture got lost on the way: you entered your code,
   * arrived in front of an empty vault, and had to guess you should come back
   * and press a second time. Worse, it was impossible: leaving the vault screen
   * closes it, so the editor found a closed vault again and sent you back to the
   * same screen, forever.
   */
  async function toggleVault() {
    if (!note) return
    if (!note.is_private && (!vault.configured || !vault.unlocked)) {
      // Pending typing is written before leaving the screen: the vault is about
      // to write to this same note, and a deferred write landing after its own
      // would reopen a conflict with no referee.
      await flushEdits()
      router.push({ pathname: '/vault', params: { claim: note.id } })
      return
    }
    // Filing the note only shows as an icon changing tint, and the note stays on
    // screen: without a word, the doubt is the same as before.
    const entering = !note.is_private
    setNotePrivate.mutate(
      {
        id: note.id,
        isPrivate: entering,
        codeName: entering ? codeName : null,
      },
      {
        onSuccess: () =>
          toast(entering ? 'Note rangée dans le coffre.' : 'Note sortie du coffre.', {
            tone: 'success',
          }),
        onError: () =>
          toast(entering ? 'Impossible de ranger la note.' : 'Impossible de la sortir.', {
            tone: 'danger',
          }),
      },
    )
  }

  /**
   * Adds or removes a tag, and adjusts the note's colour.
   *
   * Two writes and not one: tags live in a join table, the colour on the note.
   * They are independent, and just as well — if the second fails, the tag stays
   * on, which is the gesture that was asked for. The reverse would be a colour
   * without its tag.
   *
   * One tag per call, never the whole list: see `useSetNoteTag`, which explains
   * why replacing the whole set brought the old tag back when switching tags.
   *
   * The colour decision lives in `colorAfterTagChange`, where it is tested: it
   * needs neither React nor the network, and that is where the mistakes that
   * matter live — repainting a note coloured by hand, or leaving a note in the
   * tint of a category it no longer has.
   *
   * `extra` carries a tag the cache does not know yet, the one just created:
   * without it the colour could not be decided.
   */
  function setTag(tagId: string, on: boolean, extra?: Tag) {
    if (!note) return
    setNoteTag.mutate({ noteId: note.id, tagId, on })

    const known = extra ? [...(tagsQuery.data ?? []), extra] : (tagsQuery.data ?? [])
    const before = note.tags
    const after = on
      ? [...before, ...known.filter((t) => t.id === tagId && !before.some((b) => b.id === t.id))]
      : before.filter((t) => t.id !== tagId)

    const color = colorAfterTagChange(note, before, after)
    if (color !== undefined) {
      updateNote.mutate({ id: note.id, patch: { color_key: color } })
    }
  }

  function toggleTag(tagId: string) {
    setTag(tagId, !selectedTagIds.includes(tagId))
  }

  /**
   * Creating a tag from the note, without going through the Tags tab.
   *
   * The tag is attached right away. That is the whole point of the gesture: you
   * do not come here to manage your tag collection, you come to put one on the
   * note you are writing, and creating it without attaching it would leave the
   * job half done.
   *
   * A name already taken does not give an error but the existing tag. Refusing
   * would be accurate and useless: someone who types « courses » in this field
   * wants the « courses » tag, whether it was created ten seconds or a year ago.
   * So the gesture is announced as a success, and not in red under the field:
   * nothing failed, and no new tag showing up in the list must not pass for a
   * dead button either.
   *
   * The freshly created tag is handed to `setTag` directly rather than looked up
   * in `tagsQuery`: the cache is only revalidated afterwards, and the colour
   * decision would fall on an `undefined` one time out of two.
   */
  async function createAndAttachTag(name: string) {
    if (!note) return
    const tags = tagsQuery.data ?? []

    const existing = findTagNamed(tags, name)
    if (existing) {
      const already = selectedTagIds.includes(existing.id)
      if (!already) setTag(existing.id, true, existing)
      setTagError(null)
      toast(
        already
          ? `« ${existing.name} » est déjà sur la note.`
          : `« ${existing.name} » existait déjà, il est posé sur la note.`,
        { tone: 'success' },
      )
      return
    }

    try {
      const tag = await createTag.mutateAsync({
        name,
        colorKey: nextTagColor(tags, tagColorKeys),
      })
      setTag(tag.id, true, tag)
      setTagError(null)
      toast(`Tag « ${tag.name} » créé et posé.`, { tone: 'success' })
    } catch (e) {
      setTagError((e as Error).message)
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const ordered = [...note!.items]
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    reorder.mutate({ noteId: note!.id, orderedIds: ordered.map((i) => i.id) })
  }

  return (
    /**
     * The screen shrinks in front of the keyboard, instead of being covered.
     *
     * We used to type blind: the « Ajouter un élément » field is the last line
     * of the list, so the bottom of the content, and the keyboard draws over it.
     * Each added item lengthened the column above the field and pushed it a
     * little further under the keys — where you see neither what you type nor
     * the typos you make.
     *
     * `padding` on both platforms, and not the usual recipe of "`undefined` on
     * Android". That one assumes a window that shrinks by itself under the
     * keyboard, which an edge-to-edge app no longer does. The padding, for its
     * part, is computed from the real frame of this view and the keyboard's: it
     * stays right in both cases.
     *
     * The padding goes at the bottom, so the top bar does not move a point: it
     * is the room given to the content that shrinks, and the bottom action bar
     * that rises to sit on the keyboard.
     */
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}
    >
      {/* Action bar.
          Seven 48-point targets fit on a 360 screen, no longer on a 320 one.
          Wrapping then drops the last button down a row rather than letting it
          overflow the edge, where it would be clipped and so unreachable. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          paddingHorizontal: space.sm,
          paddingBottom: space.xs,
        }}
      >
        <IconButton
          icon="arrow-left"
          label="Retour"
          tooltip="Retour, en enregistrant"
          onPress={flushAndLeave}
        />
        <View style={{ flex: 1 }} />
        {/**
         * Reading or writing.
         *
         * A button is needed: a text field becomes a `textarea` on the web and
         * accepts plain text only, so markup cannot be rendered where it is
         * typed. It is also the only view where a link opens — in a field, a tap
         * places a caret.
         *
         * Switching to reading writes what was waiting: the rendering must show
         * the last keystroke, not the state of six hundred milliseconds ago.
         */}
        <IconButton
          icon={reading ? 'edit-3' : 'book-open'}
          label={reading ? 'Modifier' : 'Lire la note mise en forme'}
          tooltip={reading ? 'Revenir à l’écriture' : 'Lire, liens cliquables'}
          active={reading}
          onPress={() => {
            if (!reading) void flushEdits()
            setReading((current) => !current)
            setPanel('none')
          }}
        />
        <IconButton
          icon="save"
          label="Enregistrer"
          tooltip={unsaved ? 'Enregistrer maintenant' : 'Tout est enregistré'}
          active={unsaved}
          onPress={() => void saveNow()}
        />
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
          onPress={() => void toggleVault()}
        />
        <IconButton
          icon="archive"
          label={note.is_archived ? 'Désarchiver' : 'Archiver'}
          active={note.is_archived}
          onPress={() => {
            updateNote.mutate({ id: note.id, patch: { is_archived: !note.is_archived } })
            goBack()
          }}
        />
        {/**
         * Copy, between archiving and the trash.
         *
         * Its place is not arbitrary: the trash stays last, alone in its danger
         * tone, so that the destructive gesture keeps the corner the hand
         * already knows.
         */}
        <IconButton
          icon="copy"
          label="Copier le contenu"
          tooltip="Copier pour coller ailleurs"
          onPress={() => void copyContent()}
        />
        <IconButton
          icon="trash-2"
          label="Mettre à la corbeille"
          tone="danger"
          onPress={() => {
            trashNote.mutate(note.id)
            goBack()
          }}
        />
      </View>

      {/**
       * The note's content settles in, the action bar does not: it is the
       * frame, and a frame that moves makes you seasick.
       *
       * An animated style, and above all not an entering animation.
       *
       * `entering` hands the view's layout over to Reanimated. On this block,
       * whose whole job is to fill the room left between the two bars, the
       * height computed by `flex: 1` was lost: the block collapsed, and the
       * bottom bar rose to sit on the title — which it hid, being opaque. Moving
       * the animation to a wrapper changed nothing: the problem followed the
       * animation, not the node.
       *
       * `useRise` only animates opacity and a translation: Yoga keeps control
       * of the layout. See the rule in src/ui/transitions.ts.
       */}
      <Animated.View style={[{ flex: 1 }, rising]}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: space.xxxl,
            gap: space.md,
            /**
             * The content takes at least all the height available.
             *
             * Otherwise the column stopped at the height of what it held, and
             * the note body — a fixed 220 points tall — ended up followed by a
             * large dead zone: it looked like part of the field, but clicking
             * in it gave focus to nothing. This `flexGrow` is what gives the
             * field room to take, and the `flex: 1` further down what makes it
             * take it.
             */
            flexGrow: 1,
          }}
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
           * Code name, on a vault note only.
           *
           * It, and it alone, is what shows in the vault grid. Without a code
           * name the card stays silent: the title is not shown as a fallback,
           * that would be exactly the leak the vault exists to prevent. Hence
           * the hint under the field rather than a mere label.
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

              {/**
               * Content masking, note by note.
               *
               * A vault card shows what the note says once the vault is open,
               * which is the default and the right one: hiding it a second time
               * behind a code already entered protects nothing and makes the
               * grid unreadable. Some notes are worth more than that though, and
               * this is where their owner says so — one note at a time, never as
               * a rule imposed on all of them.
               *
               * It masks the card, it does not encrypt anything: `is_encrypted`
               * already did that on the way in. Which is why the hint says what
               * is still true — the note opens and reads as usual.
               */}
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: note.hide_content }}
                accessibilityLabel="Masquer le contenu dans le coffre"
                onPress={() =>
                  updateNote.mutate({
                    id: note.id,
                    patch: { hide_content: !note.hide_content },
                  })
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  minHeight: 48,
                  marginTop: space.xs,
                }}
              >
                <Feather
                  name={note.hide_content ? 'check-square' : 'square'}
                  size={18}
                  color={note.hide_content ? theme.accent.default : theme.text.secondary}
                />
                <View style={{ flex: 1 }}>
                  <Txt variant="label">Masquer le contenu</Txt>
                  <Txt variant="caption" tone="muted">
                    {note.hide_content
                      ? 'La carte du coffre ne montre que le nom de code. La note s’ouvre et se lit normalement.'
                      : 'La carte du coffre montre le contenu de la note, coffre ouvert.'}
                  </Txt>
                </View>
              </Pressable>
            </View>
          ) : null}

          {/* The title is set apart from the body by an engraved dividing line,
              as on a stone where the heading does not sit in the same band as
              the text. Dagaz is chosen for its symmetrical shape: it reads as an
              ornament, not as a letter that would need deciphering. */}
          <Seam mark="dagaz" />

          {note.kind === 'note' && reading ? (
            /**
             * Reading view of the body.
             *
             * It takes the same room as the field, `flex: 1` included, so that
             * switching from one to the other does not make the layout jump.
             * The wrapping `Pressable` returns to writing on touch: links are
             * `Text` with their own handler, so they take the press before it
             * and open instead of handing control back.
             */
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Revenir à l’écriture"
              onPress={() => setReading(false)}
              style={{ flex: 1, minHeight: 220 }}
            >
              {body.trim() ? (
                <RichText source={body} />
              ) : (
                <Txt variant="body" tone="muted">
                  Note vide. Toucher pour écrire.
                </Txt>
              )}
            </Pressable>
          ) : note.kind === 'note' ? (
            <TextInput
              {...champFormatable({ kind: 'body' })}
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
                  /**
                   * The field takes all the room left free under the title.
                   *
                   * Writing a note is writing on a page, not in a 220-point
                   * window followed by a large inert void. That void looked
                   * like the rest of the field: you clicked in it to keep
                   * writing, and nothing took focus. On a desktop screen it
                   * filled two thirds of the height.
                   *
                   * Beyond the available room, it is the field itself that
                   * scrolls, as it already does natively, rather than the page:
                   * the title stays in view, which is what you want from an
                   * editor. So no scrollbar appears as long as the text fits in
                   * the height on offer.
                   *
                   * The floor stays for very short windows, where the free room
                   * can be close to nothing once the software keyboard is open.
                   */
                  flex: 1,
                  minHeight: 220,
                },
                noWebOutline,
              ]}
            />
          ) : (
            <View style={{ gap: space.xs }}>
              {note.items.map((item, index) => (
                /**
                 * `layout` slides the item to its new place instead of teleporting
                 * it there. Without it, moving an item up makes it jump a row and
                 * nothing says which one moved: you have to reread the list to
                 * check the right one was moved.
                 *
                 * `entering` and `exiting` cover adding and deleting, which used
                 * to shift everything else by a row, abruptly.
                 */
                <Animated.View
                  key={item.id}
                  layout={reflow}
                  entering={appear}
                  exiting={vanish}
                  // Top, not centre: on a long item the checkbox and the buttons
                  // stay level with its first line instead of floating mid-block.
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}
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

                  {reading ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Revenir à l’écriture"
                      onPress={() => setReading(false)}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        paddingVertical: ITEM_PADDING,
                        justifyContent: 'center',
                      }}
                    >
                      {/* No line cap: an item is read in full, however long. */}
                      <RichText
                        source={itemText(item.id, item.content)}
                        tone={item.is_done ? 'muted' : 'primary'}
                        style={item.is_done ? { textDecorationLine: 'line-through' } : null}
                      />
                    </Pressable>
                  ) : (
                    <TextInput
                      {...champFormatable({ kind: 'item', id: item.id })}
                      // Controlled, unlike before: the format bar rewrites the
                      // content from outside the field, and a `defaultValue`
                      // would keep the previous text on screen.
                      value={itemText(item.id, item.content)}
                      multiline={ITEMS_WRAP}
                      // Return validates and leaves the field, as it did when the
                      // field was single-line; a multiline one would break the line.
                      submitBehavior="blurAndSubmit"
                      textAlignVertical="top"
                      onChangeText={(next) => {
                        // Items do not go through `scheduleSave`: so typing
                        // announces itself here. See `markActivity`.
                        markActivity()
                        setItemDrafts((current) => ({ ...current, [item.id]: oneLine(next) }))
                      }}
                      onEndEditing={(e) => {
                        const next = e.nativeEvent.text.trim()
                        if (next && next !== item.content) {
                          updateItem.mutate({
                            id: item.id,
                            patch: { content: next },
                            encrypted,
                          })
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
                          lineHeight: type.body.lineHeight,
                          paddingVertical: ITEM_PADDING,
                        },
                        noWebOutline,
                      ]}
                    />
                  )}

                  {/* A 44-point band, so the 36-point buttons centre on the
                      first line like the checkbox, not on the top edge. */}
                  <View
                    style={{
                      height: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                    }}
                  >
                    <IconButton
                      icon="chevron-up"
                      label="Monter"
                      disabled={index === 0}
                      onPress={() => moveItem(index, -1)}
                      size="sm"
                    />
                    <IconButton
                      icon="chevron-down"
                      label="Descendre"
                      disabled={index === note.items.length - 1}
                      onPress={() => moveItem(index, 1)}
                      size="sm"
                    />
                    <IconButton
                      icon="x"
                      label={`Supprimer ${item.content}`}
                      tooltip="Supprimer l’élément"
                      onPress={() => deleteItem.mutate(item.id)}
                      size="sm"
                    />
                  </View>
                </Animated.View>
              ))}

              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                {/**
                 * This plus used to be decoration: an icon set in a view, where a
                 * checkbox would be. It has exactly the shape of an add button,
                 * so people clicked it, and nothing happened.
                 *
                 * The return key stays the quick gesture, but it cannot be the
                 * only one: with a mouse nobody looks for it, and some software
                 * keyboards insert a line break instead of submitting.
                 */}
                <View style={{ height: 44, justifyContent: 'center' }}>
                  <IconButton
                    icon="plus"
                    label="Ajouter l’élément"
                    size="sm"
                    disabled={!draftItem.trim()}
                    onPress={addDraftItem}
                  />
                </View>
                <TextInput
                  value={draftItem}
                  multiline={ITEMS_WRAP}
                  textAlignVertical="top"
                  onChangeText={(next) => {
                    markActivity()
                    setDraftItem(oneLine(next))
                  }}
                  placeholder="Ajouter un élément"
                  placeholderTextColor={theme.text.muted}
                  // Touching the field brings it into view: the keyboard comes
                  // right after, and would otherwise settle on top of it.
                  onFocus={keepDraftInView}
                  returnKeyType="done"
                  // Submitting does not blur: items are chained without having
                  // to click back into the field each time.
                  // Both props say the same thing: `submitBehavior` is what native
                  // reads, and it wins there; react-native-web only knows
                  // `blurOnSubmit`. On native, `submit` also keeps return from
                  // breaking the line now that the field is multiline.
                  blurOnSubmit={false}
                  submitBehavior="submit"
                  onSubmitEditing={addDraftItem}
                  style={[
                    {
                      flex: 1,
                      minHeight: 44,
                      color: theme.text.primary,
                      fontFamily: type.body.fontFamily,
                      fontSize: type.body.fontSize,
                      lineHeight: type.body.lineHeight,
                      paddingVertical: ITEM_PADDING,
                    },
                    noWebOutline,
                  ]}
                />
              </View>
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* Attribute panels, at the bottom, unfolded on demand. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.line.hairline,
          backgroundColor: theme.surface.card,
          // With the keyboard open, the bottom inset protects nothing any more:
          // the system navigation bar is under the keys. Keeping it would leave a
          // strip of page floating above the keyboard.
          paddingBottom: keyboardOpen ? 0 : insets.bottom,
        }}
      >
        {/* Panels push the bar up as they open: they fade in and out rather
            than snapping. */}
        {panel === 'color' ? (
          <Animated.View
            entering={appear}
            exiting={vanish}
            style={{ paddingHorizontal: space.md, paddingTop: space.sm }}
          >
            <ColorPicker
              value={note.color_key}
              onChange={(next: TagColorKey | null) =>
                updateNote.mutate({ id: note.id, patch: { color_key: next } })
              }
            />
          </Animated.View>
        ) : null}

        {panel === 'tags' ? (
          <Animated.View
            entering={appear}
            exiting={vanish}
            style={{ paddingHorizontal: space.md, paddingTop: space.md }}
          >
            <TagPicker
              tags={tagsQuery.data ?? []}
              selectedIds={selectedTagIds}
              emptyHint="Aucun tag pour l’instant. Le premier se crée juste en dessous."
              onToggle={(tagId) => toggleTag(tagId)}
              onCreate={(name) => void createAndAttachTag(name)}
              creating={createTag.isPending}
              createError={tagError}
            />
          </Animated.View>
        ) : null}

        {panel === 'format' ? (
          <Animated.View
            entering={appear}
            exiting={vanish}
            style={{ paddingHorizontal: space.sm, paddingTop: space.sm }}
          >
            <FormatBar
              onFormat={runFormat}
              onLink={runLink}
              disabled={cible === null}
              hint={
                cible === null
                  ? 'Toucher d’abord le texte à mettre en forme.'
                  : cible.kind === 'body'
                    ? 'S’applique au texte sélectionné, ou au mot sous le curseur.'
                    : 'S’applique à l’élément de liste en cours.'
              }
            />
          </Animated.View>
        ) : null}

        {panel === 'agenda' ? (
          <Animated.View
            entering={appear}
            exiting={vanish}
            style={{ paddingHorizontal: space.md, paddingTop: space.md }}
          >
            <AgendaPanel
              noteId={note.id}
              noteProtegee={note.is_private || note.is_encrypted}
              onFerme={() => setPanel('none')}
            />
          </Animated.View>
        ) : null}

        {/* The address under the caret, offered for opening. It sits just above
            the bottom bar, so near the thumb on a phone, and above the panels so
            it does not jump when one of them opens. */}
        {lienSousCurseur ? (
          <Animated.View
            entering={appear}
            exiting={vanish}
            style={{ paddingHorizontal: space.sm, paddingTop: space.xs }}
          >
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Ouvrir ${lienSousCurseur.href}`}
              accessibilityHint="Ouvre l’adresse dans un nouvel onglet"
              onPress={() => {
                void Linking.openURL(lienSousCurseur.href)
              }}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                  borderRadius: radius.md,
                  backgroundColor: theme.surface.raised,
                  opacity: pressed ? 0.7 : 1,
                },
                noWebOutline,
              ]}
            >
              <Feather name="external-link" size={14} color={theme.accent.default} />
              {/* One line, truncated: a long address must not push the editor up
                  every time the caret brushes past it. */}
              <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                Ouvrir {lienSousCurseur.href}
              </Txt>
            </Pressable>
          </Animated.View>
        ) : null}

        <View style={{ flexDirection: 'row', paddingHorizontal: space.sm, paddingVertical: space.xs }}>
          {/* Bottom bar: tooltips open upwards, otherwise they would fall off
              the screen and flip over by themselves. */}
          {/* Formatting makes no sense in reading mode: the button disappears
              rather than staying there, greyed out and unexplained. */}
          {reading ? null : (
            <IconButton
              icon="bold"
              label="Mise en forme"
              tooltip="Gras, italique, titres, listes, liens"
              placement="top"
              active={panel === 'format'}
              onPress={() => setPanel(panel === 'format' ? 'none' : 'format')}
            />
          )}
          <IconButton
            icon="droplet"
            label="Couleur"
            tooltip="Couleur de la note"
            placement="top"
            active={panel === 'color'}
            onPress={() => setPanel(panel === 'color' ? 'none' : 'color')}
          />
          <IconButton
            icon="tag"
            label="Tags"
            tooltip="Tags de la note"
            placement="top"
            active={panel === 'tags'}
            onPress={() => {
              // The creation message does not outlive the panel closing: it
              // speaks of a gesture no longer in view.
              setTagError(null)
              setPanel(panel === 'tags' ? 'none' : 'tags')
            }}
          />
          <AgendaBouton
            actif={panel === 'agenda'}
            noteProtegee={note.is_private || note.is_encrypted}
            onPress={() => setPanel(panel === 'agenda' ? 'none' : 'agenda')}
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
    </KeyboardAvoidingView>
  )
}
