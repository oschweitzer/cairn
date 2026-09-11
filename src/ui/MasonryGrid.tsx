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
 * A grid of free-height columns, Google Keep style.
 *
 * React Native has no equivalent of `column-count`, and a multi-column FlatList
 * aligns rows on the tallest card, which leaves large gaps.
 *
 * The distribution and the width breakpoints live in src/db/noteLogic.ts, where
 * they are tested. This component only measures the width and renders the
 * result.
 *
 * ── Drag and drop ────────────────────────────────────────────────────────────
 * Provided with `onReorder`. Each card then gets a handle, and not a long
 * press: the long press is already taken by multiple selection, and giving it a
 * second meaning would make both gestures uncertain.
 *
 * `PanResponder` rather than react-native-gesture-handler: it is in React
 * Native, it works with a mouse as with a finger through react-native-web, and
 * it adds no dependency to a project that did not need one.
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
   * Requested move, as indices into `items`. When absent, the grid cannot be
   * reordered and no handle is rendered.
   */
  onReorder?: (from: number, to: number) => void
  /** What the screen reader announces on an item's handle. */
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
   * Rectangles that are measured, not computed.
   *
   * Card heights are free: `estimateHeight` only serves to distribute the
   * columns, and using it to locate a drop would mean aiming with an
   * approximation we know to be wrong.
   *
   * Two levels, because `onLayout` gives the position within the parent: a card
   * is placed in its column, the column in the grid. They have to be added up
   * to compare two cards from different columns — otherwise every column
   * overlaps at the same x, and a drop on the right landed in the first column.
   *
   * Refs and not state: these measurements change on every render and must
   * above all not trigger one.
   */
  const columnRects = useRef(new Map<number, LayoutRectangle>()).current
  const cellRects = useRef(new Map<string, LayoutRectangle>()).current

  /** Card being moved, and its expected destination. */
  const [dragged, setDragged] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  /**
   * Non-reactive mirror of everything the gesture needs.
   *
   * A `PanResponder` has to survive rendering — rebuilding one each time would
   * cut the gesture in progress, the view switching handlers in the middle of
   * the drag. But a kept handler also freezes the closures it captured when it
   * was created: the list of cards, the key function, and above all
   * `onReorder`, which depends on the notes on display.
   *
   * So the first drag worked, and the following ones applied their move to the
   * grid as it was on the very first render. Since the indices came from the
   * up-to-date grid, the result was a plausible but wrong order — sometimes even
   * identical, so invisible.
   *
   * So everything that changes goes through this box, read again at gesture
   * time.
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
   * One handler per card, kept from one render to the next.
   *
   * Created only once, with no dependency at all: everything that moves is read
   * from `live` at the moment the gesture arrives.
   */
  const responders = useRef(new Map<string, PanResponderInstance>()).current

  const gesture = useRef({
    /**
     * A card's rectangle in the grid's coordinate space.
     *
     * The column is found in the current distribution, and not remembered from
     * the card's last `onLayout`. It is a costly distinction: after a move, a
     * card changes column without necessarily changing place *within* its
     * column — same relative x, same relative y, so `onLayout` does not fire.
     * The card then kept its old column's x, and the second drag aimed beside
     * it, often at nothing: the drop was ignored, with nothing to explain why.
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
    /** The card whose rectangle contains this point, or `null`. */
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
      // The grid lives in a ScrollView: without this refusal, a vertical drag
      // would turn into scrolling instead of moving the card.
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
        // The centre of the dragged card, not the finger: you drop a card, not
        // a point, and aiming by its centre matches what you see moving.
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
                   * The dragged card goes on top and follows the finger; the
                   * others do not move.
                   *
                   * Rearranging the grid live would be livelier on a list, and
                   * unreadable here: in a masonry layout, moving a card
                   * redistributes the columns, so its neighbours would jump
                   * from one column to another at every pixel travelled. So the
                   * target card is highlighted, and nothing else moves before
                   * the drop.
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
                 * Drag handle, a sibling of the card and not its child:
                 * react-native-web renders every `Pressable` as a `<button>`,
                 * and a button inside a button breaks the PWA's hydration — the
                 * same pitfall as the one documented on the pin button.
                 *
                 * A `View` and not a `Pressable`: the `PanResponder` is what
                 * takes the gesture, and a `Pressable` on top would fight it
                 * for the press.
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
