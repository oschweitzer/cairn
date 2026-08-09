import { useMemo, useRef, useState } from 'react'
import {
  Animated,
  PanResponder,
  View,
  useWindowDimensions,
  type LayoutRectangle,
  type PanResponderInstance,
} from 'react-native'
import Feather from '@expo/vector-icons/Feather'
import { columnsForWidth, distributeIntoColumns } from '@/db/noteLogic'
import { useTheme } from './ThemeProvider'
import { Tooltip } from './Tooltip'
import { radius, space } from './theme'

/**
 * Grille en colonnes de hauteurs libres, façon Google Keep.
 *
 * React Native n'a pas d'équivalent de `column-count`, et une FlatList à
 * plusieurs colonnes aligne les lignes sur la carte la plus haute, ce qui laisse
 * de grands trous.
 *
 * La répartition et les paliers de largeur vivent dans src/db/noteLogic.ts, où ils
 * sont testés. Ce composant ne fait que mesurer la largeur et rendre le résultat.
 *
 * ── Glisser-déposer ──────────────────────────────────────────────────────────
 * Fourni avec `onReorder`. Chaque carte reçoit alors une poignée, et non un
 * appui long : l'appui long est déjà pris par la sélection multiple, et lui
 * donner un second sens rendrait les deux gestes incertains.
 *
 * `PanResponder` plutôt que react-native-gesture-handler : il est dans React
 * Native, il fonctionne à la souris comme au doigt via react-native-web, et il
 * n'ajoute aucune dépendance à un projet qui n'en avait pas besoin.
 */
export function MasonryGrid<T>({
  items,
  estimateHeight,
  renderItem,
  keyExtractor,
  gap = space.md,
  onReorder,
  reorderLabel,
}: {
  items: T[]
  estimateHeight: (item: T) => number
  renderItem: (item: T) => React.ReactNode
  keyExtractor: (item: T) => string
  gap?: number
  /**
   * Déplacement demandé, en indices sur `items`. Absent, la grille n'est pas
   * réordonnable et aucune poignée n'est rendue.
   */
  onReorder?: (from: number, to: number) => void
  /** Ce que le lecteur d'écran annonce sur la poignée d'un élément. */
  reorderLabel?: (item: T) => string
}) {
  const { width } = useWindowDimensions()
  const { theme } = useTheme()
  const columnCount = columnsForWidth(width)

  const columns = useMemo(
    () => distributeIntoColumns(items, columnCount, estimateHeight, gap),
    [items, columnCount, estimateHeight, gap],
  )

  /**
   * Rectangles mesurés, et non calculés.
   *
   * Les hauteurs de carte sont libres : `estimateHeight` ne sert qu'à répartir
   * les colonnes, et s'en servir pour localiser un dépôt reviendrait à viser
   * avec une approximation qu'on sait fausse.
   *
   * Deux niveaux, parce que `onLayout` rend la position dans le parent : une
   * carte est placée dans sa colonne, la colonne dans la grille. Il faut les
   * additionner pour comparer deux cartes de colonnes différentes — sans quoi
   * toutes les colonnes se superposent au même abscisse, et un dépôt à droite
   * atterrissait dans la première colonne.
   *
   * Des `ref` et non des états : ces mesures changent à chaque rendu et ne
   * doivent surtout pas en provoquer un.
   */
  const columnRects = useRef(new Map<number, LayoutRectangle>()).current
  const cellRects = useRef(new Map<string, LayoutRectangle>()).current

  /** Carte en cours de déplacement, et sa destination pressentie. */
  const [dragged, setDragged] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  /**
   * Miroir non réactif de tout ce dont le geste a besoin.
   *
   * Un `PanResponder` doit survivre au rendu — en reconstruire un à chaque fois
   * couperait le geste en cours, la vue changeant de gestionnaire au milieu du
   * glissement. Mais un gestionnaire gardé fige aussi les fermetures qu'il a
   * capturées à sa création : la liste des cartes, la fonction de clé, et
   * surtout `onReorder`, qui dépend des notes affichées.
   *
   * Le premier glissement marchait donc, et les suivants appliquaient leur
   * déplacement à la grille telle qu'elle était au tout premier rendu. Comme les
   * indices, eux, venaient de la grille à jour, le résultat était un ordre
   * plausible mais faux — parfois même identique, donc invisible.
   *
   * Tout ce qui change passe donc par cette boîte, relue au moment du geste.
   */
  const live = useRef({
    items,
    columns,
    keyExtractor,
    onReorder,
    target: null as string | null,
  })
  live.current.items = items
  live.current.columns = columns
  live.current.keyExtractor = keyExtractor
  live.current.onReorder = onReorder

  /**
   * Un gestionnaire par carte, gardé d'un rendu à l'autre.
   *
   * Créé une seule fois, sans aucune dépendance : tout ce qui bouge est lu dans
   * `live` au moment où le geste arrive.
   */
  const responders = useRef(new Map<string, PanResponderInstance>()).current

  const gesture = useRef({
    /**
     * Rectangle d'une carte dans le repère de la grille.
     *
     * La colonne est retrouvée dans la répartition du moment, et non retenue au
     * dernier `onLayout` de la carte. C'est une distinction qui coûte cher :
     * après un déplacement, une carte change de colonne sans forcément changer
     * de place *dans* sa colonne — même abscisse, même ordonnée relatives, donc
     * `onLayout` ne se déclenche pas. La carte gardait alors l'abscisse de son
     * ancienne colonne, et le second glissement visait à côté, souvent dans le
     * vide : le dépôt était ignoré, sans que rien ne l'explique.
     */
    rectOf(key: string): LayoutRectangle | null {
      const layout = cellRects.get(key)
      if (!layout) return null
      const index = live.current.columns.findIndex((col) =>
        col.some((item) => live.current.keyExtractor(item) === key),
      )
      const column = columnRects.get(index)
      if (!column) return null
      return {
        x: column.x + layout.x,
        y: column.y + layout.y,
        width: layout.width,
        height: layout.height,
      }
    },
    /** Carte dont le rectangle contient ce point, ou `null`. */
    cardAt(x: number, y: number): string | null {
      for (const item of live.current.items) {
        const key = live.current.keyExtractor(item)
        const r = this.rectOf(key)
        if (!r) continue
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return key
      }
      return null
    },
    reset() {
      offset.setValue({ x: 0, y: 0 })
      live.current.target = null
      setDragged(null)
      setTarget(null)
    },
  }).current

  const responderFor = (key: string): PanResponderInstance => {
    const existing = responders.get(key)
    if (existing) return existing

    const created = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // La grille vit dans une ScrollView : sans ce refus, un glissement
      // vertical partirait en défilement au lieu de déplacer la carte.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        offset.setValue({ x: 0, y: 0 })
        live.current.target = null
        setDragged(key)
        setTarget(null)
      },
      onPanResponderMove: (_e, move) => {
        offset.setValue({ x: move.dx, y: move.dy })
        const from = gesture.rectOf(key)
        if (!from) return
        // Le centre de la carte déplacée, et non le doigt : on dépose une carte,
        // pas un point, et viser par son centre correspond à ce que l'on voit
        // bouger.
        const found = gesture.cardAt(
          from.x + from.width / 2 + move.dx,
          from.y + from.height / 2 + move.dy,
        )
        const next = found === key ? null : found
        if (next !== live.current.target) {
          live.current.target = next
          setTarget(next)
        }
      },
      onPanResponderRelease: () => {
        const { items: list, keyExtractor: keyOf, onReorder: reorder, target: dropped } = live.current
        const from = list.findIndex((item) => keyOf(item) === key)
        const to = dropped ? list.findIndex((item) => keyOf(item) === dropped) : -1
        if (from !== -1 && to !== -1 && from !== to) reorder?.(from, to)
        gesture.reset()
      },
      onPanResponderTerminate: () => gesture.reset(),
    })

    responders.set(key, created)
    return created
  }

  return (
    <View style={{ flexDirection: 'row', gap }}>
      {columns.map((column, index) => (
        <View
          key={index}
          style={{ flex: 1, gap }}
          onLayout={(e) => columnRects.set(index, e.nativeEvent.layout)}
        >
          {column.map((item) => {
            const key = keyExtractor(item)
            const isDragged = dragged === key
            const isTarget = target === key

            return (
              <Animated.View
                key={key}
                onLayout={(e) => cellRects.set(key, e.nativeEvent.layout)}
                style={[
                  /**
                   * La carte déplacée passe au-dessus et suit le doigt ; les
                   * autres ne bougent pas.
                   *
                   * Réorganiser la grille en direct serait plus vivant sur une
                   * liste, et illisible ici : en maçonnerie, déplacer une carte
                   * redistribue les colonnes, donc les voisines sauteraient
                   * d'une colonne à l'autre à chaque pixel parcouru. La carte
                   * visée est donc soulignée, et rien d'autre ne bouge avant le
                   * dépôt.
                   */
                  isDragged
                    ? { zIndex: 10, opacity: 0.9, transform: offset.getTranslateTransform() }
                    : null,
                  isTarget
                    ? {
                        borderRadius: radius.lg,
                        borderWidth: 2,
                        borderColor: theme.accent.default,
                        backgroundColor: theme.accent.subtle,
                      }
                    : null,
                ]}
              >
                {renderItem(item)}

                {/**
                 * Poignée de déplacement, sœur de la carte et non son enfant :
                 * react-native-web rend chaque `Pressable` en `<button>`, et un
                 * bouton dans un bouton casse l'hydratation de la PWA — le même
                 * écueil que celui documenté sur le bouton d'épinglage.
                 *
                 * Une `View` et non un `Pressable` : c'est le `PanResponder` qui
                 * prend le geste, et un `Pressable` par-dessus se disputerait
                 * l'appui avec lui.
                 */}
                {onReorder ? (
                  <Tooltip
                    label="Glisser pour déplacer la note"
                    style={{ position: 'absolute', top: space.sm, left: space.sm, zIndex: 2 }}
                  >
                    <View
                      accessibilityRole="button"
                      accessibilityLabel={reorderLabel?.(item) ?? 'Déplacer la note'}
                      accessibilityHint="Glisser vers la note dont on veut prendre la place."
                      hitSlop={space.sm}
                      style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
                      {...responderFor(key).panHandlers}
                    >
                      <Feather
                        name="move"
                        size={14}
                        color={isDragged ? theme.accent.default : theme.text.muted}
                      />
                    </View>
                  </Tooltip>
                ) : null}
              </Animated.View>
            )
          })}
        </View>
      ))}
    </View>
  )
}
