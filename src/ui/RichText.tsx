import { Fragment } from 'react'
import { Linking, Platform, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { parseMarkup, type Block, type Span } from '@/text/markup'
import { useTheme } from './ThemeProvider'
import { fonts, space, type } from './theme'

/**
 * Displays a note's text, formatted, links included.
 *
 * The parsing lives in src/text/markup.ts, where it is tested under Node. This
 * component only translates fragments into styles — on purpose: the fragile
 * part is the parsing, not the rendering, and it has no reason to require a
 * React tree to be checked.
 *
 * ── Two modes, and the difference is not cosmetic ────────────────────────────
 * In preview — on a grid card — everything is rendered in a single `Text`
 * truncated to N lines. Links are tinted there but **not clickable**, and that
 * is a constraint, not an oversight: the card is already a `Pressable`, which
 * react-native-web renders as a `<button>`. A clickable link inside would be a
 * button within a button, invalid HTML that breaks the PWA's hydration — the
 * same pitfall as the one documented on the card's pin button. Touching the
 * card opens the note, where the link is clickable.
 *
 * In full reading — in the editor — each block is rendered separately, headings
 * take their size, bullets their indent, and links open.
 */

export function RichText({
  source,
  /** Truncates to this number of lines and renders everything as one block. Preview mode. */
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
                  // A heading keeps its weight but not its size: in a preview
                  // truncated to eight lines, a line twice as tall costs two
                  // lines of content, and the card says less about the note.
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
      {/* An empty line must take up a line. Without this non-breaking space, an
          empty `Text` shrinks to zero and the note's breathing room disappears. */}
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
      // `href` on top of `onPress`: on the web, react-native-web turns it into
      // a real anchor, so the address shows on hover, middle-click opens a tab,
      // and the link can be copied from the context menu. A mere press handler
      // would give text that reacts to clicks, which is not the same thing as a
      // link.
      //
      // `hrefAttrs` and not a flat `target`: react-native-web only copies into
      // the anchor what goes through there, a `target` as a direct prop is
      // silently ignored. `noreferrer` goes with opening in a tab: without it,
      // the opened page keeps a handle on the one that opened it. These props do
      // not exist in the React Native types, hence the cast — they are specific
      // to web rendering.
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
 * A fragment's style.
 *
 * Bold goes through the font and not through `fontWeight`: Junicode is loaded
 * as two files, and asking for a weight the family does not expose gives a
 * synthetic bold, thicker and less crisp than the real one.
 *
 * Italic, on the other hand, is synthetic — there is no file for it. That is
 * deliberate: a computed oblique still reads as italic, whereas a computed bold
 * on a serif with fine serifs smears.
 */
function spanStyle(span: Span, accent: string): TextStyle {
  // A single property carries every decoration: combining them in the same
  // string is the only way to get a struck-through link that stays underlined.
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
