import { Pressable, View } from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { displayTitle, isEmptyNote } from '@/db/noteLogic'
import type { NoteWithRelations } from '@/db/select'
import { useTheme } from './ThemeProvider'
import { Txt } from './components'
import { Tooltip } from './Tooltip'
import { radius, space } from './theme'

/**
 * Carte de note ou de liste dans la grille.
 *
 * Sur la couleur de note, écart assumé par rapport à Google Keep. Keep peint tout
 * le fond de la carte. Impossible ici : la palette de tags est faite de teintes
 * de valeur moyenne, calibrées pour des puces et des bordures à 3:1, pas pour
 * porter du texte par-dessus. Les utiliser en fond ferait tomber le contraste du
 * texte sous les seuils que le reste du thème respecte.
 *
 * La couleur passe donc par la bordure et par une veine verticale sur le bord
 * gauche. C'est aussi plus juste dans le langage de la pierre, un filon dans la
 * roche plutôt qu'un bloc teinté, et le texte reste sur la strate neutre.
 */

const PREVIEW_ITEMS = 5

export function NoteCard({
  note,
  onPress,
  onTogglePin,
  onLongPress,
  selectionMode = false,
  selected = false,
}: {
  note: NoteWithRelations
  /** Ouvre la note, ou bascule sa sélection si le mode sélection est actif. */
  onPress: () => void
  onTogglePin: () => void
  /** Entrée dans le mode sélection. */
  onLongPress?: () => void
  selectionMode?: boolean
  selected?: boolean
}) {
  const { theme, tagColor } = useTheme()
  const vein = note.color_key ? tagColor(note.color_key) : null

  // Une note du coffre montre son nom de code, jamais son titre. Une note du
  // coffre sans nom de code ne montre rien : c'est le seul repli qui ne laisse
  // pas fuir ce que le coffre est censé cacher.
  const heading = displayTitle(note)
  const empty = isEmptyNote(note)
  const shown = note.items.slice(0, PREVIEW_ITEMS)
  const remaining = note.items.length - shown.length
  const doneCount = note.items.filter((i) => i.is_done).length

  /**
   * Le conteneur est une View, pas un Pressable, et le bouton d'épinglage est un
   * frère du corps cliquable plutôt que son enfant.
   *
   * Ce n'est pas un détail de style : react-native-web rend chaque Pressable en
   * `<button>`, et un bouton imbriqué dans un bouton est du HTML invalide qui
   * casse l'hydratation de la PWA. Deux frères superposés donnent le même geste
   * sans le défaut.
   */
  return (
    <View
      style={{
        borderRadius: radius.lg,
        // Une carte sélectionnée prend l'accent, y compris quand elle porte déjà
        // une veine colorée : l'état de sélection doit primer sur la décoration.
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.accent.default : (vein ?? theme.line.hairline),
        // overflow caché pour que la veine soit rognée par le rayon d'angle.
        overflow: 'hidden',
      }}
    >
      {vein ? (
        <View
          // Décorative : la couleur est déjà portée par la bordure, et un
          // lecteur d'écran n'a rien à annoncer ici.
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: vein, zIndex: 1 }}
        />
      ) : null}

      <Pressable
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityLabel={heading ?? (empty ? 'Note vide' : 'Note sans titre')}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        onPress={onPress}
        onLongPress={onLongPress}
        // Assez long pour ne pas se déclencher sur un défilement, assez court pour
        // ne pas donner l'impression que rien ne se passe.
        delayLongPress={350}
        style={({ pressed }) => ({
          backgroundColor: selected
            ? theme.accent.subtle
            : pressed
              ? theme.surface.raised
              : theme.surface.card,
          padding: space.md,
          paddingLeft: vein ? space.md + 4 : space.md,
          // Réserve la place du bouton d'épinglage, qui flotte par-dessus.
          paddingRight: space.md + 28,
          gap: space.sm,
        })}
      >
        <View style={{ gap: space.xxs }}>
          {heading ? (
            <Txt variant="title" numberOfLines={2}>
              {heading}
            </Txt>
          ) : empty ? (
            /**
             * Sans ce repère, une note sans aucun contenu se réduit à une lamelle
             * de la hauteur de son padding, où l'icône d'épinglage dépasse même
             * du bord. L'éditeur écarte normalement les notes restées vides en
             * sortant, mais une note vide peut arriver d'un autre appareil ou
             * d'une session interrompue : elle doit rester lisible et cliquable.
             */
            <Txt variant="title" tone="muted">
              {note.kind === 'checklist' ? 'Liste vide' : 'Note vide'}
            </Txt>
          ) : null}
          {note.kind === 'checklist' && note.items.length > 0 ? (
            <Txt variant="caption" tone="muted">
              {doneCount} sur {note.items.length}
            </Txt>
          ) : null}
        </View>

        {note.kind === 'note' && note.body ? (
          <Txt variant="body" tone="secondary" numberOfLines={8}>
            {note.body}
          </Txt>
        ) : null}

        {note.kind === 'checklist' ? (
          <View style={{ gap: space.xs }}>
            {shown.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {/* Non interactif dans la grille, volontairement : cocher ici
                    se confondrait avec l'ouverture de la note. */}
                <View
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    borderWidth: 1,
                    borderColor: item.is_done ? theme.accent.default : theme.line.strong,
                    backgroundColor: item.is_done ? theme.accent.default : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.is_done ? (
                    <Feather name="check" size={9} color={theme.text.onAccent} />
                  ) : null}
                </View>
                <Txt
                  variant="body"
                  tone={item.is_done ? 'muted' : 'secondary'}
                  numberOfLines={1}
                  style={[{ flex: 1 }, item.is_done ? { textDecorationLine: 'line-through' } : null]}
                >
                  {item.content}
                </Txt>
              </View>
            ))}
            {remaining > 0 ? (
              <Txt variant="caption" tone="muted">
                et {remaining} de plus
              </Txt>
            ) : null}
          </View>
        ) : null}

        {note.tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xxs }}>
            {note.tags.map((tag) => (
              <View key={tag.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                    backgroundColor: tagColor(tag.color_key),
                  }}
                />
                <Txt variant="caption" tone="muted">
                  {tag.name}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      {/**
       * En mode sélection, la pastille de sélection remplace le bouton
       * d'épinglage. Deux raisons : l'épinglage se fait alors depuis la barre
       * d'actions sur toute la sélection, et un bouton actif au milieu de cartes
       * devenues des cases à cocher serait ambigu. C'est un simple repère, pas un
       * Pressable, la carte entière étant déjà la cible.
       */}
      {selectionMode ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            top: space.sm,
            right: space.sm,
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: selected ? 0 : 1,
            borderColor: theme.line.strong,
            backgroundColor: selected ? theme.accent.default : theme.surface.recessed,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}
        >
          {selected ? <Feather name="check" size={14} color={theme.text.onAccent} /> : null}
        </View>
      ) : (
        /* Frère du corps, pas enfant : voir le commentaire sur le conteneur.
           C'est l'enveloppe d'infobulle qui porte le placement, le bouton se
           contentant de remplir la case qu'elle lui donne. */
        <Tooltip
          label={note.is_pinned ? 'Désépingler' : 'Épingler'}
          style={{ position: 'absolute', top: space.sm, right: space.sm, zIndex: 2 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={note.is_pinned ? 'Désépingler' : 'Épingler'}
            accessibilityState={{ selected: note.is_pinned }}
            onPress={onTogglePin}
            // Glyphe discret, zone tactile élargie par hitSlop : le geste reste
            // confortable sans alourdir la carte visuellement.
            hitSlop={space.md}
            style={{
              width: 32,
              height: 32,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather
              name="bookmark"
              size={16}
              color={note.is_pinned ? theme.accent.default : theme.text.muted}
            />
          </Pressable>
        </Tooltip>
      )}
    </View>
  )
}

/**
 * Hauteur approximative d'une carte, en unités arbitraires. Sert uniquement à
 * répartir les cartes entre les colonnes de la grille.
 *
 * Une vraie mesure demanderait un rendu en deux passes et ferait scintiller la
 * grille au chargement. Une estimation suffit : l'erreur se traduit par des
 * colonnes légèrement inégales, ce qui est sans conséquence.
 */
export function estimateCardHeight(note: NoteWithRelations): number {
  const heading = displayTitle(note)
  let height = 40
  // Le repère « Note vide » occupe la place d'un titre d'une ligne.
  if (!heading && isEmptyNote(note)) height += 24
  if (heading) height += Math.min(2, Math.ceil(heading.length / 24)) * 24
  if (note.kind === 'note' && note.body) {
    height += Math.min(8, Math.ceil(note.body.length / 32)) * 24
  }
  if (note.kind === 'checklist') {
    height += Math.min(PREVIEW_ITEMS, note.items.length) * 24
    if (note.items.length > PREVIEW_ITEMS) height += 16
    if (note.items.length > 0) height += 16
  }
  if (note.tags.length > 0) height += 20
  return height
}
