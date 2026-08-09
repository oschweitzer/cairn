import { Fragment } from 'react'
import { Linking, Platform, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { parseMarkup, type Block, type Span } from '@/text/markup'
import { useTheme } from './ThemeProvider'
import { fonts, space, type } from './theme'

/**
 * Affiche le texte d'une note, mis en forme, liens compris.
 *
 * Le découpage vit dans src/text/markup.ts, où il est testé sous Node. Ce
 * composant ne fait que traduire des fragments en styles — c'est délibéré : la
 * partie fragile est l'analyse, pas le rendu, et elle n'a aucune raison
 * d'exiger un arbre React pour être vérifiée.
 *
 * ── Deux modes, et la différence n'est pas cosmétique ────────────────────────
 * En aperçu — sur une carte de la grille — tout est rendu dans un seul `Text`
 * tronqué à N lignes. Les liens y sont teintés mais **pas cliquables**, et c'est
 * une contrainte, pas un oubli : la carte est déjà un `Pressable`, que
 * react-native-web rend en `<button>`. Un lien cliquable à l'intérieur serait un
 * bouton dans un bouton, du HTML invalide qui casse l'hydratation de la PWA —
 * le même écueil que celui documenté sur le bouton d'épinglage de la carte.
 * Toucher la carte ouvre la note, où le lien est cliquable.
 *
 * En lecture pleine — dans l'éditeur — chaque bloc est rendu à part, les titres
 * prennent leur taille, les puces leur retrait, et les liens s'ouvrent.
 */

export function RichText({
  source,
  /** Tronque à ce nombre de lignes et rend tout d'un bloc. Mode aperçu. */
  numberOfLines,
  tone = 'primary',
  style,
}: {
  source: string | null | undefined
  numberOfLines?: number
  tone?: 'primary' | 'secondary' | 'muted'
  style?: StyleProp<TextStyle>
}) {
  const { theme } = useTheme()
  const blocks = parseMarkup(source)
  const color = theme.text[tone]

  const base: TextStyle = {
    color,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
  }

  if (numberOfLines !== undefined) {
    return (
      <Text numberOfLines={numberOfLines} style={[base, style]}>
        {blocks.map((block, index) => (
          <Fragment key={index}>
            {index > 0 ? '\n' : null}
            {block.kind === 'bullet' ? '•  ' : null}
            {block.spans.map((span, i) => (
              <Text
                key={i}
                style={[
                  // Un titre garde sa graisse mais pas sa taille : dans un aperçu
                  // tronqué à huit lignes, une ligne deux fois plus haute coûte
                  // deux lignes de contenu, et la carte dit moins de la note.
                  block.level > 0 ? { fontFamily: fonts.serifMedium } : null,
                  spanStyle(span, theme.accent.default),
                ]}
              >
                {span.text}
              </Text>
            ))}
          </Fragment>
        ))}
      </Text>
    )
  }

  return (
    <View style={{ gap: space.xxs }}>
      {blocks.map((block, index) => (
        <BlockLine key={index} block={block} base={base} accent={theme.accent.default} />
      ))}
    </View>
  )
}

function BlockLine({
  block,
  base,
  accent,
}: {
  block: Block
  base: TextStyle
  accent: string
}) {
  const heading: TextStyle =
    block.level === 1
      ? { fontFamily: fonts.serifMedium, fontSize: 22, lineHeight: 30 }
      : block.level === 2
        ? { fontFamily: fonts.serifMedium, fontSize: 19, lineHeight: 26 }
        : {}

  const content = (
    <Text style={[base, heading, { flex: 1 }]}>
      {block.spans.map((span, i) => (
        <Inline key={i} span={span} accent={accent} />
      ))}
      {/* Une ligne vide doit occuper une ligne. Sans cette espace insécable,
          `Text` vide se réduit à zéro et l'aération de la note disparaît. */}
      {block.spans.length === 0 ? ' ' : null}
    </Text>
  )

  if (block.kind !== 'bullet') return content

  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Text style={[base, { opacity: 0.7 }]}>•</Text>
      {content}
    </View>
  )
}

function Inline({ span, accent }: { span: Span; accent: string }) {
  if (!span.href) return <Text style={spanStyle(span, accent)}>{span.text}</Text>

  const href = span.href
  return (
    <Text
      accessibilityRole="link"
      // `href` en plus de `onPress` : sur le web, react-native-web en fait une
      // vraie ancre, donc l'adresse s'affiche au survol, le clic du milieu
      // ouvre un onglet, et le lien se copie par le menu contextuel. Un simple
      // gestionnaire de pression donnerait un texte qui réagit au clic, ce qui
      // n'est pas la même chose qu'un lien.
      //
      // `hrefAttrs` et non `target` posé à plat : react-native-web ne recopie
      // dans l'ancre que ce qui passe par là, un `target` en propriété directe
      // est ignoré sans bruit. `noreferrer` va avec l'ouverture dans un onglet :
      // sans lui, la page ouverte garde une poignée sur celle qui l'a ouverte.
      // Ces propriétés n'existent pas dans les types de React Native, d'où la
      // conversion — elles sont propres au rendu web.
      {...(Platform.OS === 'web'
        ? ({
            href,
            hrefAttrs: { target: '_blank', rel: 'noreferrer noopener' },
          } as object)
        : {})}
      onPress={() => {
        void Linking.openURL(href)
      }}
      style={spanStyle(span, accent)}
    >
      {span.text}
    </Text>
  )
}

/**
 * Style d'un fragment.
 *
 * Le gras passe par la police et non par `fontWeight` : Junicode est chargée en
 * deux fichiers, et demander une graisse que la famille n'expose pas donne un
 * gras synthétique, plus épais et moins net que le vrai.
 *
 * L'italique, lui, est bien synthétique — il n'y a pas de fichier pour. C'est
 * assumé : une oblique calculée reste lisible comme de l'italique, alors qu'un
 * gras calculé sur un serif à empattements fins bave.
 */
function spanStyle(span: Span, accent: string): TextStyle {
  // Une seule propriété porte toutes les décorations : les cumuler dans la même
  // chaîne est la seule façon d'avoir un lien barré qui reste souligné.
  const decorations = [
    span.underline || span.href ? 'underline' : null,
    span.strike ? 'line-through' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    ...(span.bold ? { fontFamily: fonts.serifMedium } : {}),
    ...(span.italic ? { fontStyle: 'italic' } : {}),
    ...(span.href ? { color: accent } : {}),
    ...(decorations
      ? { textDecorationLine: decorations as TextStyle['textDecorationLine'] }
      : {}),
  }
}
