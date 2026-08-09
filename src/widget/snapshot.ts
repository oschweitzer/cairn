import type { NoteWithRelations } from '../db/noteLogic'
import { byPinThenOrder, displayTitle } from '../db/noteLogic'
import { plainText } from '../text/markup'
import type { Tag } from '../db/types'
import type { TagColorKey } from '../ui/theme'

/**
 * Instantané des notes pour le widget Android.
 *
 * ── Pourquoi un instantané, et non une requête ───────────────────────────────
 * Le widget vit hors de l'application : c'est un processus du système, réveillé
 * par le lanceur, sans session Supabase et souvent sans réseau. Il ne peut donc
 * pas aller chercher les notes lui-même, et lui confier un jeton pour qu'il
 * essaie serait à la fois compliqué et imprudent.
 *
 * L'application écrit donc ce qu'elle sait, à chaque fois que la liste change.
 * Le widget lit un fichier local et n'a plus rien à demander à personne : il
 * s'affiche instantanément, hors ligne comme en ligne.
 *
 * ── Ce qui n'y entre pas ─────────────────────────────────────────────────────
 * Rien du coffre, sauf réglage explicite — et même alors, seulement le nom de
 * code. Le corps d'une note masquée ne sort jamais, quel que soit le réglage :
 * l'instantané est un fichier en clair dans les préférences de l'application,
 * et le coffre existe précisément pour que son contenu ne traîne pas là.
 *
 * Les notes archivées et la corbeille non plus : le widget montre ce sur quoi on
 * travaille, pas ce qu'on a rangé.
 */

export type WidgetNote = {
  id: string
  /** Nom de code pour une note du coffre, titre sinon. Peut être vide. */
  title: string
  /** Aperçu déjà débarrassé de son balisage. Vide pour une note du coffre. */
  preview: string
  /** Clé de palette, ou chaîne vide. Le widget la résout en couleur. */
  color: TagColorKey | ''
  /** Vrai pour une liste, pour que le widget montre le bon pictogramme. */
  checklist: boolean
  pinned: boolean
  tagIds: string[]
}

export type WidgetTag = { id: string; name: string; color: TagColorKey }

export type WidgetSnapshot = {
  /** Incrémenté à chaque changement de forme, pour que le natif sache lire. */
  version: 1
  notes: WidgetNote[]
  tags: WidgetTag[]
  /** Horodatage d'écriture, affiché nulle part : sert au diagnostic. */
  writtenAt: string
}

/** Au-delà, la liste du widget devient un fichier lourd pour rien. */
const MAX_NOTES = 60

/** Longueur d'aperçu : deux lignes sur un widget large, guère plus. */
const PREVIEW = 120

export function buildSnapshot(
  notes: NoteWithRelations[],
  tags: Tag[],
  options: { showPrivate: boolean; now?: Date },
): WidgetSnapshot {
  const visible = notes
    .filter((note) => {
      if (note.deleted_at !== null || note.is_archived) return false
      if (note.is_private) return options.showPrivate
      return true
    })
    .sort(byPinThenOrder)
    .slice(0, MAX_NOTES)

  return {
    version: 1,
    writtenAt: (options.now ?? new Date()).toISOString(),
    notes: visible.map((note) => ({
      id: note.id,
      title: displayTitle(note) ?? '',
      /**
       * Une note du coffre n'a pas d'aperçu, même quand on a choisi de la
       * montrer. Le réglage dit « je veux savoir qu'elle est là », pas « je veux
       * que son contenu s'affiche sur l'écran d'accueil du téléphone ».
       */
      preview: note.is_private ? '' : previewOf(note),
      color: note.color_key ?? '',
      checklist: note.kind === 'checklist',
      pinned: note.is_pinned,
      tagIds: note.tags.map((t) => t.id),
    })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color_key })),
  }
}

/**
 * Aperçu d'une note : son corps, ou ses premiers éléments s'il s'agit d'une
 * liste. Sans balisage — `**gras**` s'afficherait tel quel dans une `RemoteViews`,
 * qui ne sait pas ce qu'est une astérisque.
 */
function previewOf(note: NoteWithRelations): string {
  const source =
    note.kind === 'checklist'
      ? note.items.map((item) => `• ${item.content}`).join('\n')
      : (note.body ?? '')

  const text = plainText(source).trim()
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW).trimEnd()}…` : text
}
