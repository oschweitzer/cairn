import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import Animated from 'react-native-reanimated'
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
import { colorAfterTagChange, findTagNamed, isEmptyNote, nextTagColor } from '@/db/noteLogic'
import type { Tag } from '@/db/types'
import { useNote } from '@/db/select'
import { applyFormat, insertLink, linkAt, type Format, type Selection } from '@/text/markup'
import { useVault } from '@/vault/VaultProvider'
import { useTheme } from '@/ui/ThemeProvider'
import { Button, Card, Seam, Txt, noWebOutline } from '@/ui/components'
import { FormatBar } from '@/ui/FormatBar'
import { IconButton } from '@/ui/IconButton'
import { RichText } from '@/ui/RichText'
import { ColorPicker, TagPicker } from '@/ui/pickers'
import { AgendaBouton, AgendaPanel } from '@/ui/AgendaPanel'
import { RuneLoader } from '@/ui/RuneLoader'
import { useToast } from '@/ui/Toast'
import { appear, reflow, useRise, vanish } from '@/ui/transitions'
import { radius, space, tagColorKeys, type, type TagColorKey } from '@/ui/theme'

/** Délai avant enregistrement, pour ne pas écrire à chaque frappe. */
const AUTOSAVE_MS = 600

type Panel = 'none' | 'color' | 'tags' | 'agenda' | 'format'

/**
 * Champ auquel s'applique la mise en forme.
 *
 * La barre ne connaît aucun champ : elle nomme un geste, l'écran sait où le
 * porter. Sans cette cible, le même bouton devrait exister deux fois — une pour
 * le corps, une pour l'élément de liste en cours — et se désactiver tout seul
 * selon le focus, ce qui ferait clignoter la barre à chaque changement de champ.
 */
type Cible = { kind: 'body' } | { kind: 'item'; id: string }

function memeChamp(a: Cible | null, b: Cible): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind === 'body' || a.id === (b as { id: string }).id
}

/** Un champ de saisie vu depuis le web, où la référence est le nœud DOM. */
type ChampWeb = HTMLTextAreaElement | HTMLInputElement

const ECOUTEURS = new WeakMap<ChampWeb, EventListener>()

/** Le nœud DOM derrière un champ, sur le web uniquement. */
function champWeb(champ: TextInput | null): ChampWeb | null {
  if (Platform.OS !== 'web' || !champ) return null
  const noeud = champ as unknown as ChampWeb
  return typeof noeud.addEventListener === 'function' ? noeud : null
}

/**
 * Fait qu'un Cmd ou Ctrl + clic sur une adresse, dans le champ, l'ouvre.
 *
 * Le web seulement, et par un écouteur DOM plutôt que par une propriété de
 * `TextInput`, qui n'expose pas le clic. Il n'y a pas de voie plus propre : un
 * champ multiligne devient un `textarea`, et un `textarea` ne contient que du
 * texte nu — ni ancre, ni fragment stylé. On lit donc où le navigateur vient de
 * poser le curseur, et on cherche l'adresse à cet endroit.
 *
 * Aucun équivalent par appui long sur Android : ce geste appartient au menu de
 * sélection du système dans un champ de texte, et le lui reprendre coûterait le
 * copier-coller. La barre « Ouvrir » sert là, et sert partout.
 */
function poseOuvreLien(champ: TextInput | null) {
  const el = champWeb(champ)
  if (!el || ECOUTEURS.has(el)) return
  // `EventListener` et non `(e: MouseEvent) => void` : sur une union de
  // types d'éléments, TypeScript ne choisit plus la surcharge typée de
  // `addEventListener`. Le rétrécissement se fait donc ici, une fois.
  const surClic: EventListener = (evenement) => {
    const e = evenement as MouseEvent
    // Cmd sur macOS, Ctrl ailleurs. Les deux sont acceptés parce qu'ils ne se
    // marchent pas dessus : sur macOS, Ctrl + clic *est* un clic droit, qui émet
    // `mousedown` puis `contextmenu` sans jamais émettre `click`. La branche
    // `ctrlKey` n'y est donc jamais atteinte, et n'y vole aucun menu. Constaté
    // dans un navigateur, pas supposé.
    if (!e.metaKey && !e.ctrlKey) return
    const lien = linkAt(el.value ?? '', el.selectionStart ?? 0)
    if (!lien) return
    // Le clic a déjà posé le curseur, ce qui est bien ce qu'on veut ; on lui
    // retire seulement la suite, pour que rien d'autre ne réagisse.
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

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  const { note, isLoading } = useNote(id)
  const tagsQuery = useTags()
  const vault = useVault()
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
   * La note vit-elle dans le coffre chiffré ? Les mutations ne peuvent pas le
   * deviner : elles ne reçoivent qu'un identifiant. C'est donc l'éditeur qui le
   * dit, à chaque écriture qui touche au texte.
   */
  const encrypted = Boolean(note?.is_private)

  const [panel, setPanel] = useState<Panel>('none')
  const [draftItem, setDraftItem] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const rising = useRise()

  /**
   * Lecture ou écriture.
   *
   * Un champ de saisie ne sait pas afficher du texte mis en forme : sur le web
   * il devient un `textarea`, qui n'accepte que du texte nu. Il faut donc deux
   * vues du même contenu, et un bouton pour passer de l'une à l'autre — c'est le
   * marché habituel des éditeurs à balisage, et il est franc : on voit le
   * balisage quand on écrit, le résultat quand on lit.
   *
   * La lecture est aussi la seule vue où un lien peut être cliqué : dans un
   * champ de saisie, un appui pose un curseur.
   */
  const [reading, setReading] = useState(false)

  /**
   * Champ visé par la barre de mise en forme, et l'étendue qui y est
   * sélectionnée. Les deux vivent ici et non dans les champs : la barre est
   * ailleurs dans l'arbre, et c'est l'écran qui fait le lien.
   */
  const [cible, setCible] = useState<Cible | null>(null)
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 })

  /**
   * Sélection à imposer au prochain rendu, puis plus jamais.
   *
   * Après une mise en forme, le curseur doit se retrouver entre les marques que
   * l'on vient de poser, sinon il repart en fin de champ et il faut recliquer
   * pour continuer à écrire. La seule façon de le déplacer est la propriété
   * `selection`, mais la laisser en place figerait le curseur à chaque frappe :
   * on la retire donc dès que le champ a signalé où il en est.
   */
  const [selectionImposee, setSelectionImposee] = useState<Selection | null>(null)

  /**
   * Texte des éléments de liste en cours de modification.
   *
   * Les champs étaient non contrôlés — `defaultValue` et écriture à la sortie —
   * ce qui suffisait tant que rien d'autre que la frappe ne les modifiait. La
   * barre de mise en forme, elle, réécrit le contenu depuis l'extérieur : sans
   * valeur contrôlée, le champ garderait à l'écran le texte d'avant.
   */
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({})

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
          encrypted,
          current: { title: note.title, body: note.body },
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
    [note, updateNote, encrypted],
  )

  // Un départ d'écran ne doit pas emporter la dernière frappe avec lui.
  useEffect(() => {
    return () => {
      if (pending.current) clearTimeout(pending.current)
    }
  }, [])

  /**
   * Écrit tout de suite ce qui attendait, sans rien annoncer.
   *
   * Séparé de l'accusé de réception parce que deux appelants n'ont pas les mêmes
   * besoins : le bouton d'enregistrement veut un mot à afficher, le détour par
   * le coffre veut seulement que la frappe en cours soit posée avant de quitter
   * l'écran.
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

    // Une note vide n'est pas enregistrée : elle serait écartée en sortant de
    // l'éditeur, et prétendre le contraire serait un mensonge d'une minute.
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
   * Enregistrement à la demande.
   *
   * L'enregistrement différé fait déjà le travail, et le bouton n'existe pas
   * pour le remplacer : il existe parce qu'un enregistrement invisible ne
   * rassure personne. Écrire un texte long sans jamais voir la moindre trace du
   * fait qu'il est en sûreté est inconfortable, et le doute pousse à des gestes
   * de repli, comme recopier la note ailleurs.
   *
   * D'où la réponse systématique, y compris quand il n'y avait rien à écrire :
   * un bouton qui ne dit rien une fois sur deux réintroduit exactement le doute
   * qu'il devait lever.
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
        // Le texte saisi reste dans l'état local, donc à l'écran : l'échec ne
        // coûte rien tant qu'on ne quitte pas la note, et c'est ce qu'il faut
        // dire plutôt que de recopier une erreur réseau.
        toast('Enregistrement impossible, le texte reste à l’écran.', { tone: 'danger' })
        break
    }
  }, [flushEdits, toast])

  /**
   * Ajout d'un élément de liste.
   *
   * L'échec était muet : le champ se vidait, aucun élément n'apparaissait, et
   * rien ne distinguait une écriture perdue d'un bouton qui ne marche pas. Le
   * texte est donc rendu au champ si l'écriture échoue, plutôt que perdu.
   */
  const addDraftItem = useCallback(() => {
    if (!note) return
    const content = draftItem.trim()
    if (!content) return
    setDraftItem('')
    addItem.mutate(
      { noteId: note.id, content, position: note.items.length, encrypted },
      {
        onError: () => {
          setDraftItem((current) => (current ? current : content))
          toast('Élément non ajouté, le texte est revenu dans le champ.', { tone: 'danger' })
        },
      },
    )
  }, [note, draftItem, addItem, toast, encrypted])

  /** Texte affiché d'un élément : le brouillon s'il existe, sinon la base. */
  const itemText = useCallback(
    (id: string, fallback: string) => itemDrafts[id] ?? fallback,
    [itemDrafts],
  )

  /**
   * Champs de saisie, par cible, pour pouvoir leur rendre le focus.
   *
   * Appuyer sur un bouton de la barre de mise en forme sort du champ — c'est ce
   * que fait un clic sur un bouton, sur le web comme ailleurs. Le navigateur
   * replie alors la sélection, et la position de curseur calculée par la
   * commande n'a plus rien à quoi s'appliquer : on se retrouvait au début du
   * texte, à devoir recliquer entre chaque marque.
   */
  const champs = useRef(new Map<string, TextInput | null>()).current
  const cleChamp = (pour: Cible) => (pour.kind === 'body' ? 'body' : `item:${pour.id}`)

  /**
   * Écrit un texte mis en forme dans le champ visé, et y replace le curseur.
   *
   * Un seul chemin pour les deux sortes de champ, parce que la différence entre
   * un corps de note et un élément de liste tient à où l'on écrit, pas à ce que
   * l'on écrit. L'élément part en base tout de suite : contrairement au corps, il
   * n'a pas d'enregistrement différé, et attendre la sortie du champ perdrait la
   * mise en forme si l'on quitte l'écran entre-temps.
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
       * Le focus d'abord, la sélection ensuite, et dans cet ordre.
       *
       * La propriété `selection` ne se pose que sur un champ qui a le focus, et
       * le champ vient de le perdre au profit du bouton sur lequel on a appuyé.
       * L'imposer avant serait sans effet, et le curseur repartirait au début du
       * texte — il fallait recliquer dans le champ entre chaque marque.
       *
       * L'objet est recréé volontairement : la sélection imposée n'est reprise
       * que si la propriété change, or elle vaut peut-être déjà cette valeur-là.
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
   * L'adresse dans laquelle se trouve le curseur, s'il y en a une.
   *
   * C'est ce qui remplace le lien cliquable pendant l'écriture, faute de pouvoir
   * en poser un dans un champ de saisie. La barre n'apparaît donc que lorsqu'elle
   * a quelque chose à ouvrir, et se retire dès que le curseur en sort — elle ne
   * demande pas à être cherchée, elle se présente au bon moment.
   *
   * Rien en lecture : les liens y sont déjà cliquables, et une barre de plus n'y
   * dirait que ce qui est sous les yeux.
   */
  const lienSousCurseur = useMemo(
    () => (reading ? null : linkAt(texteCible() ?? '', selection.start)),
    [reading, texteCible, selection.start],
  )

  /**
   * Gestionnaires communs à tout champ que la barre peut mettre en forme.
   *
   * `onSelectionChange` sert deux fins : suivre ce qui est sélectionné, et
   * relâcher la sélection imposée une fois qu'elle a pris. Sans le second, le
   * curseur resterait bloqué là où la dernière commande l'avait posé.
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
          encrypted,
          current: { title: nextTitle, body: nextBody },
          patch: { title: nextTitle, body: nextBody, code_name: nextCodeName },
        })
      }
    }
    router.back()
  }, [note, title, body, codeName, updateNote, purgeNote, router, encrypted])

  if (!note) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <IconButton icon="arrow-left" label="Retour" onPress={() => router.back()} />
          {/**
           * Trois raisons très différentes de ne pas trouver la note, et il faut
           * les distinguer.
           *
           * La première n'en est pas une : la recherche n'est pas finie. Ouvrir
           * une note à froid, ou recharger la page sur le web, arrive ici avant
           * que la requête ne réponde. Annoncer une disparition à ce moment-là
           * est un contresens, et c'est ce que faisait cet écran.
           *
           * Le coffre se referme tout seul au bout de cinq minutes et au passage
           * en arrière-plan. Si une note du coffre était ouverte, elle disparaît
           * sous les yeux de son lecteur : c'est le comportement voulu, le
           * contenu ne doit pas rester à l'écran après la fermeture. Mais
           * annoncer une suppression depuis un autre appareil serait un mensonge
           * inquiétant pour quelque chose de parfaitement normal.
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
   * Frappe en attente d'écriture. Le bouton d'enregistrement s'allume tant qu'il
   * reste quelque chose à poser, et s'éteint dès que c'est fait : l'état du
   * bouton devient l'indicateur permanent que l'enregistrement différé n'avait
   * pas, sans ajouter un mot de plus à l'écran.
   */
  const unsaved =
    (title.trim() || null) !== note.title ||
    (body || null) !== note.body ||
    (note.is_private ? codeName.trim() || null : null) !== note.code_name

  /**
   * Entrée et sortie du coffre.
   *
   * Le coffre doit être ouvert pour y ranger quoi que ce soit, et ce n'est pas
   * une formalité de sécurité : une note masquée pendant que le coffre est fermé
   * disparaîtrait de la liste visible sans réapparaître nulle part, et l'éditeur
   * ouvert dessus afficherait « note introuvable » dans la seconde. On envoie
   * donc d'abord vers le coffre, la note reste où elle est.
   *
   * ── L'intention voyage avec la navigation ────────────────────────────────────
   * Le détour emporte l'identifiant de la note, et le coffre la range lui-même en
   * s'ouvrant. Sans cela le geste se perdait en route : on posait son code, on
   * arrivait devant un coffre vide, et il fallait deviner qu'il fallait revenir
   * appuyer une seconde fois. Pire, c'était impossible : quitter l'écran du
   * coffre le referme, l'éditeur retrouvait donc un coffre fermé et renvoyait
   * vers le même écran, indéfiniment.
   */
  async function toggleVault() {
    if (!note) return
    if (!note.is_private && (!vault.configured || !vault.unlocked)) {
      // La frappe en attente est posée avant de quitter l'écran : le coffre va
      // écrire sur cette même note, et une écriture différée qui atterrirait
      // après la sienne rouvrirait un conflit sans arbitre.
      await flushEdits()
      router.push({ pathname: '/vault', params: { claim: note.id } })
      return
    }
    // Le rangement ne se voit qu'à l'icône qui change de teinte, et la note reste
    // à l'écran : sans un mot, le doute est le même qu'avant.
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
   * Pose ou retire un tag, et ajuste la couleur de la note.
   *
   * Deux écritures et non une : les tags vivent dans une table de liaison, la
   * couleur sur la note. Elles sont indépendantes, et c'est tant mieux — si la
   * seconde échoue, le tag reste posé, ce qui est le geste demandé. L'inverse
   * serait une couleur sans son tag.
   *
   * Un seul tag par appel, jamais la liste entière : voir `useSetNoteTag`, où
   * l'on explique pourquoi remplacer l'ensemble faisait revenir l'ancien tag
   * quand on en changeait.
   *
   * La décision sur la couleur est dans `colorAfterTagChange`, où elle est
   * testée : elle n'a besoin ni de React ni du réseau, et c'est là que vivent
   * les erreurs qui comptent — repeindre une note colorée à la main, ou laisser
   * une note sur la teinte d'une catégorie qu'elle n'a plus.
   *
   * `extra` porte un tag que le cache ne connaît pas encore, celui qui vient
   * d'être créé : sans lui la couleur ne pourrait pas être décidée.
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
   * Création d'un tag depuis la note, sans passer par l'onglet Tags.
   *
   * Le tag est posé dans la foulée. C'est tout l'intérêt du geste : on ne vient
   * pas ici gérer sa collection de tags, on vient en poser un sur la note
   * qu'on est en train d'écrire, et le créer sans l'associer laisserait le
   * travail à moitié fait.
   *
   * Un nom déjà pris ne donne pas une erreur mais le tag existant. Refuser
   * serait exact et inutile : quelqu'un qui tape « courses » dans ce champ veut
   * le tag « courses », qu'il ait été créé il y a dix secondes ou l'an dernier.
   * Le geste est donc annoncé comme une réussite, et non en rouge sous le
   * champ : rien n'a échoué, et l'absence de nouveau tag dans la liste ne doit
   * pas non plus passer pour un bouton mort.
   *
   * Le tag fraîchement créé est passé à `setTag` en main propre plutôt que
   * cherché dans `tagsQuery` : le cache n'est revalidé qu'après, et la décision
   * sur la couleur retomberait sur un `undefined` une fois sur deux.
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
    <View style={{ flex: 1, backgroundColor: theme.surface.page, paddingTop: insets.top }}>
      {/* Barre d'actions.
          Sept cibles de 48 points tiennent sur un écran de 360, plus sur un
          écran de 320. Le retour à la ligne fait alors descendre le dernier
          bouton d'un cran plutôt que de le laisser dépasser du bord, où il
          serait rogné et donc inatteignable. */}
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
         * Lecture ou écriture.
         *
         * Il faut bien un bouton : un champ de saisie devient un `textarea` sur
         * le web et n'accepte que du texte nu, donc le balisage ne peut pas se
         * rendre à l'endroit où on le tape. C'est aussi la seule vue où un lien
         * s'ouvre — dans un champ, un appui pose un curseur.
         *
         * Le passage en lecture pose ce qui attendait : le rendu doit montrer la
         * dernière frappe, pas l'état d'il y a six cents millisecondes.
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

      {/**
       * Le contenu de la note se pose, la barre d'actions non : elle est le
       * cadre, et un cadre qui bouge donne le mal de mer.
       *
       * Un style animé, et surtout pas une animation d'entrée.
       *
       * `entering` confie la disposition de la vue à Reanimated. Sur ce bloc-ci,
       * dont tout le rôle est d'occuper la place laissée libre entre les deux
       * barres, la hauteur calculée par le `flex: 1` était perdue : le bloc
       * s'écrasait, et la barre du bas remontait se poser sur le titre — qu'elle
       * masquait, étant opaque. Déplacer l'animation sur une enveloppe ne
       * changeait rien, le problème suivait l'animation, pas le nœud.
       *
       * `useRise` n'anime que l'opacité et une translation : Yoga garde la main
       * sur la mise en page. Voir la règle dans src/ui/transitions.ts.
       */}
      <Animated.View style={[{ flex: 1 }, rising]}>
        <ScrollView
          contentContainerStyle={{
            padding: space.lg,
            paddingBottom: space.xxxl,
            gap: space.md,
            /**
             * Le contenu occupe au minimum toute la hauteur offerte.
             *
             * Sans cela la colonne s'arrêtait à la hauteur de ce qu'elle
             * portait, et le corps de la note — haut de 220 points fixes — se
             * retrouvait suivi d'une grande zone morte : elle avait l'air de
             * faire partie du champ, mais cliquer dedans ne donnait le focus à
             * rien. C'est ce `flexGrow` qui donne au champ de la place à
             * prendre, et le `flex: 1` plus bas qui la lui fait prendre.
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

          {note.kind === 'note' && reading ? (
            /**
             * Vue de lecture du corps.
             *
             * Elle prend la même place que le champ, `flex: 1` compris, pour que
             * passer de l'une à l'autre ne fasse pas sauter la mise en page. La
             * `Pressable` qui l'enveloppe ramène à l'écriture au toucher : les
             * liens sont des `Text` avec leur propre gestionnaire, ils prennent
             * donc l'appui avant elle et s'ouvrent au lieu de rendre la main.
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
                   * Le champ prend toute la place laissée libre sous le titre.
                   *
                   * Écrire une note, c'est écrire dans une page, pas dans une
                   * fenêtre de 220 points suivie d'un grand vide inerte. Le
                   * vide en question ressemblait à la suite du champ : on
                   * cliquait dedans pour continuer à écrire, et rien ne prenait
                   * le focus. Sur un écran de bureau il occupait les deux tiers
                   * de la hauteur.
                   *
                   * Au-delà de la place disponible, c'est le champ lui-même qui
                   * défile, comme il le fait déjà nativement, plutôt que la
                   * page : le titre reste en vue, ce qui est ce qu'on veut d'un
                   * éditeur. Une barre de défilement n'apparaît donc plus tant
                   * que le texte tient dans la hauteur offerte.
                   *
                   * Le plancher reste pour les fenêtres très basses, où la
                   * place libre peut être quasi nulle une fois le clavier
                   * logiciel ouvert.
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
                 * `layout` fait glisser l'élément vers sa nouvelle place au lieu de
                 * l'y téléporter. Sans cela, monter un élément le fait sauter d'un
                 * rang et rien ne dit lequel a bougé : il faut relire la liste pour
                 * vérifier que le bon a été déplacé.
                 *
                 * `entering` et `exiting` couvrent l'ajout et la suppression, qui
                 * décalaient tout le reste d'un cran, sec.
                 */
                <Animated.View
                  key={item.id}
                  layout={reflow}
                  entering={appear}
                  exiting={vanish}
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

                  {reading ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Revenir à l’écriture"
                      onPress={() => setReading(false)}
                      style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                    >
                      <RichText
                        source={itemText(item.id, item.content)}
                        numberOfLines={2}
                        tone={item.is_done ? 'muted' : 'primary'}
                        style={item.is_done ? { textDecorationLine: 'line-through' } : null}
                      />
                    </Pressable>
                  ) : (
                    <TextInput
                      {...champFormatable({ kind: 'item', id: item.id })}
                      // Contrôlé, contrairement à avant : la barre de mise en
                      // forme réécrit le contenu depuis l'extérieur du champ, et
                      // un `defaultValue` garderait à l'écran le texte d'avant.
                      value={itemText(item.id, item.content)}
                      onChangeText={(next) =>
                        setItemDrafts((current) => ({ ...current, [item.id]: next }))
                      }
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
                        },
                        noWebOutline,
                      ]}
                    />
                  )}

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
                </Animated.View>
              ))}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {/**
                 * Ce plus était un décor : une icône posée dans une vue, à
                 * l'emplacement d'une case à cocher. Il a exactement la forme d'un
                 * bouton d'ajout, donc on clique dessus, et il ne se passait rien.
                 *
                 * La touche entrée reste le geste rapide, mais elle ne peut pas
                 * être le seul : à la souris on ne la cherche pas, et certains
                 * claviers logiciels renvoient à la ligne au lieu de valider.
                 */}
                <IconButton
                  icon="plus"
                  label="Ajouter l’élément"
                  size="sm"
                  disabled={!draftItem.trim()}
                  onPress={addDraftItem}
                />
                <TextInput
                  value={draftItem}
                  onChangeText={setDraftItem}
                  placeholder="Ajouter un élément"
                  placeholderTextColor={theme.text.muted}
                  returnKeyType="done"
                  // blurOnSubmit désactivé : on enchaîne les éléments sans avoir à
                  // recliquer dans le champ à chaque fois.
                  blurOnSubmit={false}
                  onSubmitEditing={addDraftItem}
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
      </Animated.View>

      {/* Panneaux d'attributs, en bas, dépliés à la demande. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.line.hairline,
          backgroundColor: theme.surface.card,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Les panneaux poussent la barre vers le haut en s'ouvrant : ils
            apparaissent et disparaissent en fondu plutôt que d'un coup sec. */}
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

        {/* L'adresse sous le curseur, offerte à l'ouverture. Elle se pose juste
            au-dessus de la barre basse, donc près du pouce sur un téléphone, et
            au-dessus des panneaux pour ne pas sauter quand l'un d'eux s'ouvre. */}
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
              {/* Une seule ligne, tronquée : une adresse longue ne doit pas
                  repousser l'éditeur vers le haut à chaque fois qu'on la frôle. */}
              <Txt variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                Ouvrir {lienSousCurseur.href}
              </Txt>
            </Pressable>
          </Animated.View>
        ) : null}

        <View style={{ flexDirection: 'row', paddingHorizontal: space.sm, paddingVertical: space.xs }}>
          {/* Barre basse : les bulles s'ouvrent vers le haut, sinon elles
              tomberaient hors de l'écran et basculeraient d'elles-mêmes. */}
          {/* La mise en forme n'a pas de sens en lecture : le bouton disparaît
              plutôt que de rester là, éteint et sans explication. */}
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
              // Le message de création ne survit pas à la fermeture du panneau :
              // il parle d'un geste qu'on ne voit plus.
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
    </View>
  )
}
