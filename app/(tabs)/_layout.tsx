import {
  Platform,
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Tabs } from 'expo-router'
import Feather from '@expo/vector-icons/Feather'
import { glow, useHover } from '@/ui/components'
import { Glyph } from '@/ui/glyphs'
import { Rune, type RuneName } from '@/ui/runes'
import { useTheme } from '@/ui/ThemeProvider'
import { fonts, radius, space, withAlpha } from '@/ui/theme'

/**
 * The row of standing stones only exists for a pointer.
 *
 * On a phone, the bar touches both edges and each target is a quarter of the
 * screen: that is what the thumb needs, and detaching the cells would only
 * shrink targets that are already just right. On the web, the same bar spread
 * across the full width is nothing but an indistinct band, and the hover glow
 * drew a large shapeless rectangle on it. So the stones are only set down where
 * there is a mouse and room.
 */
const isWeb = Platform.OS === 'web'

/** Height of the engraving. Enough to read, little enough to stay a mark. */
const RUNE_SIZE = 12

/**
 * One engraving per tab, purely ornamental — the rule of runes.tsx holds: none of
 * these runes carries the tab's meaning, the icon and the word take care of
 * that. Algiz goes to the vault, which already bears it on its standing stone.
 */
const TAB_RUNES: Record<string, RuneName> = {
  index: 'berkanan',
  vault: 'algiz',
  tags: 'gebo',
  settings: 'tiwaz',
}

/**
 * Tab bar: a hover glow across the whole cell, a chip on the active tab.
 *
 * ── The glow covers the icon AND its label ───────────────────────────────────
 * A first version only applied it to the icon, which left the word below it
 * dark: the target the pointer aims at is the whole tab, so the response must
 * cover the whole tab. Hence taking over the button itself rather than just its
 * pictogram.
 *
 * ── What taking it over does not cost ────────────────────────────────────────
 * On the web, react-native-web renders a real anchor as soon as a view gets an
 * `href` — so it is not the default button that brings the link, it is the
 * prop. Passing it on keeps the anchor, its address at the bottom of the
 * browser, and middle-click.
 *
 * What remains is to reproduce what the original button did with those clicks:
 * on a modified click we do nothing and let the browser open its tab; on a plain
 * click we stop it, otherwise the page would reload entirely instead of
 * navigating.
 */

type ClickModifiers = {
  metaKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  button?: number
}

function isPlainLeftClick(event: unknown): boolean {
  const click = event as ClickModifiers
  const modified = Boolean(click.metaKey || click.altKey || click.ctrlKey || click.shiftKey)
  return !modified && (click.button == null || click.button === 0)
}

function TabButton({
  children,
  style,
  href,
  onPress,
  rune,
  'aria-selected': selected,
  ...rest
}: Omit<PressableProps, 'children' | 'style' | 'onPress'> & {
  rune: RuneName
  /**
   * This, and nothing else, is how the bar says which tab is active.
   *
   * The first version read `accessibilityState.selected`, which is the old
   * form: react-navigation 7 passes `aria-selected`. So the flag was always
   * false, and the active tab received none of its styles — no outline, no
   * tint, no engraving. The defect was invisible on review, a missing prop
   * raising no error.
   */
  'aria-selected'?: boolean
  // Copied from what the bar actually passes: a plain child and style, where
  // `Pressable` would also accept function forms, and a handler that receives
  // the mouse event on the web.
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  href?: string
  onPress?: (event: GestureResponderEvent | React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const focused = selected === true

  // `href` is a react-native-web extension, missing from the React Native
  // types. Yet it, and it alone, is what renders an anchor instead of a div —
  // hence the cast rather than dropping the prop.
  const anchor = { href } as unknown as PressableProps

  return (
    <Pressable
      {...rest}
      {...hoverProps}
      {...anchor}
      onPress={(event: GestureResponderEvent) => {
        if (Platform.OS === 'web' && href != null) {
          if (!isPlainLeftClick(event)) return
          ;(event as { preventDefault?: () => void }).preventDefault?.()
        }
        onPress?.(event)
      }}
      aria-selected={selected}
      style={[
        style,
        // Each tab becomes a stone set down: an outline, a base, and air around
        // it. That is what was missing — four cells joined across the full
        // width do not read as four objects.
        isWeb
          ? {
              marginVertical: space.sm,
              marginHorizontal: space.xs,
              /**
               * The stone has a size; it is the cell that stretches, not the
               * stone.
               *
               * Without a bound, each tab took a quarter of a desktop screen —
               * nearly five hundred points for an icon and a word, four empty
               * slabs rather than a row. The bound is set here and not through
               * `tabBarItemStyle` because the row cannot be reached:
               * `tabBarStyle` dresses a column container sitting above it, and
               * centring has no effect there.
               *
               * It never bites on a phone, where four times this width exceeds
               * the screen.
               */
              maxWidth: 168,
              alignSelf: 'center',
              width: '100%',
              paddingTop: space.xs,
              borderRadius: radius.md,
              /**
               * The active tab was hard to see, and measuring said so: its
               * `accent.subtle` background held only 1.13:1 against the
               * inactive stone, in other words nothing. That token is meant for
               * a chip on a card, not for telling two neighbouring surfaces
               * apart.
               *
               * The accent diluted to 34% reaches 1.85:1, and the double outline
               * in full accent carries the rest: 2.83:1 against the seam. The
               * stone you stand on is lit, the others stay in shadow.
               */
              borderWidth: focused ? 2 : 1,
              borderColor: focused ? theme.accent.default : theme.line.hairline,
              backgroundColor: focused
                ? withAlpha(theme.accent.default, 0.34)
                : theme.surface.raised,
            }
          : null,
        hovered ? glow(withAlpha(theme.accent.default, 0.28), 18) : null,
      ]}
    >
      {/**
       * The engraving only marks the stone you stand on.
       *
       * It was first drawn on all four, dimmed on three — which gave four grey
       * strokes pressed against four icons, unreadable and competing. A mark
       * that appears everywhere no longer marks anything.
       *
       * The room stays reserved on inactive tabs, otherwise all the content
       * would shift by ten points or so at every change.
       */}
      {isWeb ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: RUNE_SIZE, justifyContent: 'center', marginBottom: space.xs }}
        >
          {focused ? <Rune name={rune} size={RUNE_SIZE} color={theme.accent.default} /> : null}
        </View>
      ) : null}
      {children}
    </Pressable>
  )
}

/**
 * Active tab chip, on mobile only.
 *
 * On the web, the lit stone and its engraving already say where you stand: one
 * more chip behind the icon would make a third marker for a single state, and
 * three signals for the same thing read worse than one. On mobile, where there
 * is neither stone nor engraving, it stays the only cue besides the tint.
 */
function TabIcon({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const { theme } = useTheme()
  if (isWeb) return <>{children}</>
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 48,
        paddingHorizontal: space.md,
        paddingVertical: space.xxs,
        borderRadius: radius.pill,
        backgroundColor: focused ? theme.accent.subtle : 'transparent',
      }}
    >
      {children}
    </View>
  )
}

/**
 * The button does not know its route: the tab declaration is what gives it its
 * engraving. So the rune is added here, to the props the bar provides — hence
 * the parameter left to the type the bar imposes.
 */
const tabButton =
  (name: keyof typeof TAB_RUNES) =>
  (props: Omit<React.ComponentProps<typeof TabButton>, 'rune'>) => (
    <TabButton {...props} rune={TAB_RUNES[name]} />
  )

export default function TabsLayout() {
  const { theme } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.surface.page },
        tabBarActiveTintColor: theme.accent.default,
        // The muted grey was too pale for a bar that carries all navigation: a
        // tab you cannot read is a tab you do not visit.
        tabBarInactiveTintColor: theme.text.secondary,
        /**
         * The label stays under the icon, whatever the width.
         *
         * The bar switches to a horizontal layout by itself on a wide screen,
         * and the engraving got wedged between the edge and the icon there, tiny
         * and unreadable — a defect only a screenshot revealed. The stone wants
         * its engraving on top, its icon in the middle and its word below: a
         * stack, not a line.
         */
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          backgroundColor: theme.surface.card,
          // Height for the engraving, on the web only: the mobile layout has
          // none and must not grow for nothing.
          ...(isWeb ? { height: 88 } : null),
          // The seam stands in for the drop shadow to set the bar off from the content.
          borderTopWidth: 1,
          borderTopColor: theme.line.hairline,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.sansMedium,
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarButton: tabButton('index'),
          title: 'Notes',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="layers" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      {/* The vault is a place where notes live, on a par with the grid, and not
          a setting. It used to sit at the grid's top right, which made it
          invisible from every other screen. */}
      <Tabs.Screen
        name="vault"
        options={{
          tabBarButton: tabButton('vault'),
          title: 'Coffre',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <Glyph name="chest" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="tags"
        options={{
          tabBarButton: tabButton('tags'),
          title: 'Tags',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="tag" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarButton: tabButton('settings'),
          title: 'Réglages',
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon focused={focused}>
              <Feather name="sliders" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
    </Tabs>
  )
}
