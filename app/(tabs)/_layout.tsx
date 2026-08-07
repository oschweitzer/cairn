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
 * La rangée de pierres levées n'existe qu'au pointeur.
 *
 * Sur un téléphone, la barre touche les deux bords et chaque cible fait le quart
 * de l'écran : c'est ce qu'il faut pour le pouce, et détacher les cellules ne
 * ferait que rétrécir des cibles déjà justes. Sur le web, la même barre étalée
 * sur toute la largeur n'est plus qu'un bandeau indistinct, et le halo de survol
 * y dessinait un grand rectangle sans forme. Les pierres n'y sont donc posées
 * que là où il y a une souris et de la place.
 */
const isWeb = Platform.OS === 'web'

/** Hauteur de la gravure. Assez pour se lire, assez peu pour rester une marque. */
const RUNE_SIZE = 12

/**
 * Une gravure par onglet, purement ornementale — la règle de runes.tsx tient :
 * aucune de ces runes ne porte le sens de l'onglet, l'icône et le mot s'en
 * chargent. Algiz revient au coffre, qui la porte déjà sur sa pierre levée.
 */
const TAB_RUNES: Record<string, RuneName> = {
  index: 'berkanan',
  vault: 'algiz',
  tags: 'gebo',
  settings: 'tiwaz',
}

/**
 * Barre d'onglets : halo au survol sur toute la cellule, pastille sur l'onglet
 * actif.
 *
 * ── Le halo porte sur l'icône ET son libellé ─────────────────────────────────
 * Une première version ne l'appliquait qu'à l'icône, ce qui laissait le mot en
 * dessous éteint : la cible visée par le pointeur est l'onglet entier, la
 * réponse doit couvrir l'onglet entier. D'où la reprise du bouton lui-même
 * plutôt que de son seul pictogramme.
 *
 * ── Ce que la reprise ne coûte pas ───────────────────────────────────────────
 * Sur le web, react-native-web rend une vraie ancre dès qu'une vue reçoit un
 * `href` — ce n'est donc pas le bouton par défaut qui apporte le lien, c'est la
 * propriété. En la relayant, on garde l'ancre, son adresse en bas du navigateur
 * et le clic du milieu.
 *
 * Reste à reproduire ce que le bouton d'origine faisait de ces clics-là : sur un
 * clic modifié on ne fait rien et on laisse le navigateur ouvrir son onglet ;
 * sur un clic simple on l'en empêche, sans quoi la page se rechargerait
 * entièrement au lieu de naviguer.
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
   * C'est ainsi, et pas autrement, que la barre dit quel onglet est actif.
   *
   * La première version lisait `accessibilityState.selected`, qui est la forme
   * ancienne : react-navigation 7 passe `aria-selected`. Le drapeau valait donc
   * toujours faux, et l'onglet actif ne recevait aucun de ses styles — ni
   * contour, ni teinte, ni gravure. Le défaut était invisible en relecture, une
   * propriété absente ne faisant pas d'erreur.
   */
  'aria-selected'?: boolean
  // Recopié sur ce que la barre passe réellement : un enfant et un style
  // simples, là où `Pressable` accepterait aussi des formes fonctionnelles, et
  // un gestionnaire qui reçoit l'événement de souris sur le web.
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  href?: string
  onPress?: (event: GestureResponderEvent | React.MouseEvent<HTMLAnchorElement>) => void
}) {
  const { theme } = useTheme()
  const { hovered, hoverProps } = useHover()
  const focused = selected === true

  // `href` est une extension de react-native-web, absente des types de React
  // Native. C'est pourtant elle, et elle seule, qui fait rendre une ancre au
  // lieu d'un div — d'où la conversion plutôt que l'abandon de la propriété.
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
        // Chaque onglet devient une pierre posée : un contour, une assise, et de
        // l'air autour. C'est ce qui manquait — quatre cellules jointives sur
        // toute la largeur ne se lisent pas comme quatre objets.
        isWeb
          ? {
              marginVertical: space.sm,
              marginHorizontal: space.xs,
              /**
               * La pierre a une taille ; c'est la case qui s'étire, pas elle.
               *
               * Sans borne, chaque onglet occupait un quart d'un écran de
               * bureau — près de cinq cents points pour une icône et un mot,
               * soit quatre dalles vides plutôt qu'une rangée. La borne est
               * posée ici et non par `tabBarItemStyle` parce que la rangée n'est
               * pas atteignable : `tabBarStyle` habille un conteneur en colonne
               * situé au-dessus d'elle, et le centrage y reste sans effet.
               *
               * Elle ne mord jamais sur un téléphone, où quatre fois cette
               * largeur dépasse l'écran.
               */
              maxWidth: 168,
              alignSelf: 'center',
              width: '100%',
              paddingTop: space.xs,
              borderRadius: radius.md,
              /**
               * L'onglet actif se voyait mal, et la mesure le disait : son fond
               * `accent.subtle` ne tenait que 1,13:1 contre la pierre inactive,
               * autrement dit rien. C'est un jeton pensé pour une puce sur une
               * carte, pas pour distinguer deux surfaces voisines.
               *
               * L'accent dilué à 34 % passe à 1,85:1, et le contour double en
               * accent franc porte le reste : 2,83:1 contre la couture. La pierre
               * où l'on se tient est éclairée, les autres restent dans l'ombre.
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
       * La gravure ne marque que la pierre où l'on se tient.
       *
       * Elle était d'abord tracée sur les quatre, éteinte sur trois — ce qui
       * donnait quatre traits gris serrés contre quatre icônes, illisibles et
       * concurrents. Une marque qui apparaît partout ne marque plus rien.
       *
       * La place reste réservée sur les onglets inactifs, sans quoi tout le
       * contenu se décalerait d'une dizaine de points à chaque changement.
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
 * Pastille de l'onglet actif, sur mobile uniquement.
 *
 * Sur le web, la pierre éclairée et sa gravure disent déjà où l'on se tient :
 * une pastille de plus derrière l'icône ferait un troisième marqueur pour un
 * seul état, et trois signaux pour la même chose se lisent plus mal qu'un.
 * Sur mobile, où il n'y a ni pierre ni gravure, elle reste le seul repère avec
 * la teinte.
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
 * Le bouton ne connaît pas sa route : c'est la déclaration d'onglet qui lui
 * donne sa gravure. La rune est donc ajoutée ici, aux propriétés que la barre
 * fournit — d'où le paramètre laissé au type que la barre impose.
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
        // Le gris atténué était trop pâle pour une barre qui porte toute la
        // navigation : un onglet qu'on ne lit pas ne se visite pas.
        tabBarInactiveTintColor: theme.text.secondary,
        /**
         * Le libellé reste sous l'icône, quelle que soit la largeur.
         *
         * La barre bascule d'elle-même en disposition horizontale sur un écran
         * large, et la gravure s'y retrouvait coincée entre le bord et l'icône,
         * minuscule et illisible — un défaut que seule une capture d'écran a
         * révélé. La pierre veut sa gravure au-dessus, son icône au milieu et son
         * mot dessous : c'est un empilement, pas une ligne.
         */
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          backgroundColor: theme.surface.card,
          // De la hauteur pour la gravure, sur le web seulement : le gabarit
          // mobile n'en a pas et ne doit pas grandir pour rien.
          ...(isWeb ? { height: 88 } : null),
          // La couture remplace l'ombre portée pour détacher la barre du contenu.
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
      {/* Le coffre est un lieu où vivent des notes, au même rang que la grille,
          et non un réglage. Il était en haut à droite de celle-ci, ce qui le
          rendait invisible depuis tous les autres écrans. */}
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
