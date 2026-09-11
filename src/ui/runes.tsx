import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/**
 * Runic iconography. Ornamental, never functional.
 *
 * ── Why vectors and not text ─────────────────────────────────────────────────
 * Unicode's Runic block (U+16A0 to U+16FF) exists, but almost no system font
 * covers it: not Roboto on Android, not the browsers' default stack. So a
 * `<Text>ᚱ</Text>` would display an empty rectangle on the vast majority of
 * devices, and checking it on your own proves nothing. So the runes are drawn,
 * which has a side benefit: the stroke width follows the requested colour and
 * size, like a real burin.
 *
 * ── Why they never carry meaning ─────────────────────────────────────────────
 * The principle set at the start still holds: character comes through
 * surfaces, colour, typography and motion, and affordances stay conventional.
 * So a rune never replaces an icon you have to understand to act. A checkbox
 * stays a checkbox, the trash keeps its trash icon. Runes mark, they do not
 * indicate. They are therefore all hidden from screen readers.
 *
 * ── Geometry ─────────────────────────────────────────────────────────────────
 * Each rune is described in a 12 by 20 unit box, in straight strokes only,
 * which is the very definition of the alphabet: the futhark is angular because
 * it was cut with a knife into wood and with a point into stone, where a curve
 * is hard and follows the grain of the material. Stroke ends are square for the
 * same reason.
 */

/** Elder futhark, the subset actually used in the interface. */
const PATHS = {
  // ᚠ fehu
  fehu: 'M2 0 V20 M2 4 L9 1 M2 10 L9 7',
  // ᚢ uruz
  uruz: 'M2 20 V2 L9 6 V20',
  // ᚦ thurisaz
  thurisaz: 'M2 0 V20 M2 5 L8 9 L2 13',
  // ᚨ ansuz
  ansuz: 'M2 0 V20 M2 2 L8 6 M2 8 L8 12',
  // ᚱ raido
  raido: 'M2 0 V20 M2 1 L9 5 L2 10 M2 10 L8 19',
  // ᚲ kaunan
  kaunan: 'M9 1 L2 10 L9 19',
  // ᚷ gebo
  gebo: 'M1 1 L11 19 M11 1 L1 19',
  // ᚹ wunjo
  wunjo: 'M2 0 V20 M2 1 L9 5 L2 10',
  // ᚺ hagalaz
  hagalaz: 'M2 0 V20 M10 0 V20 M2 8 L10 12',
  // ᚾ naudiz
  naudiz: 'M6 0 V20 M1 13 L11 7',
  // ᛁ isaz
  isaz: 'M6 0 V20',
  // ᛉ algiz
  algiz: 'M6 20 V5 M6 5 L1 0 M6 5 L11 0',
  // ᛊ sowilo
  sowilo: 'M9 1 L3 7 L9 13 L3 19',
  // ᛏ tiwaz
  tiwaz: 'M6 20 V2 M1 8 L6 2 L11 8',
  // ᛒ berkanan
  berkanan: 'M2 0 V20 M2 1 L9 5 L2 9 M2 10 L9 15 L2 19',
  // ᛖ ehwaz
  ehwaz: 'M2 20 V3 L6 8 L10 3 V20',
  // ᛗ mannaz
  mannaz: 'M2 0 V20 M10 0 V20 M2 2 L10 10 M10 2 L2 10',
  // ᛚ laguz
  laguz: 'M2 0 V20 M2 1 L8 7',
  // ᛜ ingwaz
  ingwaz: 'M6 3 L11 10 L6 17 L1 10 Z',
  // ᛞ dagaz
  dagaz: 'M2 19 L2 1 L10 19 L10 1 Z',
  // ᛟ othala
  othala: 'M6 1 L11 7 L6 13 L1 7 Z M4 11 L1 19 M8 11 L11 19',
} as const

export type RuneName = keyof typeof PATHS

export const runeNames = Object.keys(PATHS) as RuneName[]

/**
 * "Cairn" transliterated into the elder futhark: ᚲᚨᛁᚱᚾ.
 *
 * The futhark has no C, the hard sound goes through kaunan. So the
 * transliteration is K-A-I-R-N, which reads correctly aloud and invents
 * nothing.
 */
export const CAIRN: readonly RuneName[] = ['kaunan', 'ansuz', 'isaz', 'raido', 'naudiz']

const BOX_W = 12
const BOX_H = 20

/**
 * Raw geometry, for renders that cannot go through `<Rune>`: the engraving on
 * the standing stone below, and the animated wait of src/ui/RuneLoader.tsx,
 * whose stroke changes colour and must therefore be an animated path rather
 * than an ordinary one.
 *
 * The outline stays defined here, in a single place. Copying it elsewhere would
 * let it drift at the first touch-up.
 */
export const runeBox = { width: BOX_W, height: BOX_H } as const

export function runePath(name: RuneName): string {
  return PATHS[name]
}

/**
 * A rune. `size` is the desired height, the width follows from it.
 *
 * The stroke width follows the size by default, otherwise an enlarged rune
 * would look engraved with an ever finer point.
 */
export function Rune({
  name,
  size = 14,
  color,
  strokeWidth,
}: {
  name: RuneName
  size?: number
  color: string
  strokeWidth?: number
}) {
  const width = (size * BOX_W) / BOX_H
  const stroke = strokeWidth ?? Math.max(1.25, size / 11)

  return (
    <Svg
      width={width}
      height={size}
      // The one-unit margin keeps the stroke from being clipped at the edges of
      // the box, where several runes run.
      viewBox={`-1 -1 ${BOX_W + 2} ${BOX_H + 2}`}
    >
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
    </Svg>
  )
}

/**
 * A sequence of runes on one line, hidden from screen readers.
 *
 * The caller provides `label` when the runic word visually replaces readable
 * text, so the line is still announced. Without `label`, the whole is purely
 * decorative and disappears from the accessibility tree.
 */
export function RuneRow({
  runes,
  size = 14,
  color,
  gap,
  label,
  style,
}: {
  runes: readonly RuneName[]
  size?: number
  color: string
  gap?: number
  label?: string
  style?: React.ComponentProps<typeof View>['style']
}) {
  const spacing = gap ?? Math.round(size * 0.42)

  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing }, style]}
    >
      {runes.map((name, i) => (
        <Rune key={`${name}-${i}`} name={name} size={size} color={color} />
      ))}
    </View>
  )
}

/**
 * An engraved standing stone, for empty screens.
 *
 * It replaces the Feather icon that held this role: an interface pictogram in
 * the middle of an empty screen is a "there is nothing here" sign, whereas an
 * upright stone is the very object the app piles up. The silhouette is
 * deliberately irregular, a raised stone is not a rectangle.
 */
export function StandingStone({
  size = 72,
  color,
  carveColor,
  runes = ['algiz', 'isaz'],
}: {
  size?: number
  /** The stone's outline. */
  color: string
  /** Engraving, usually the accent. */
  carveColor: string
  runes?: readonly RuneName[]
}) {
  // A 60 by 84 box; the stone takes 44 of the width and leaves the base room to breathe.
  const width = (size * 60) / 84

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={size} viewBox="0 0 60 84">
        {/**
         * Silhouette: wide at the base, tapering towards the top, a lopsided
         * peak.
         *
         * Which way it flares is not a matter of taste. A shape narrower at the
         * bottom than in the middle reads at once as a coffin, which is what
         * the first outline gave. A planted stone does the opposite: it is
         * massive at the ground and thins as it rises, and its two sides are
         * not symmetrical.
         */}
        <Path
          d="M13 80 L16 52 L18 28 L24 10 L33 5 L40 16 L43 44 L46 80 Z"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="miter"
          fill="none"
        />
        {/* Ground line, wider than the base: the stone is planted. */}
        <Path d="M8 80 H52" stroke={color} strokeWidth={2} strokeLinecap="square" />
        {/* Engraving, centred on the face. */}
        <CarvedRunes runes={runes} color={carveColor} />
      </Svg>
    </View>
  )
}

/**
 * Runes engraved on the stone's face. Pulled out to keep `StandingStone`
 * readable, and because stacking them in a column has nothing to do with the
 * silhouette.
 */
function CarvedRunes({ runes, color }: { runes: readonly RuneName[]; color: string }) {
  const height = 13
  const total = runes.length * height + (runes.length - 1) * 5
  // Centred on the lower part of the face, not on the box: the top of the
  // stone is too narrow to take an engraving without cramping it.
  const top = 46 - total / 2

  return (
    <>
      {runes.map((name, i) => {
        const y = top + i * (height + 5)
        const scale = height / BOX_H
        // Each rune is brought into the stone's coordinate space by a
        // transform, rather than by recomputing the paths.
        return (
          <Path
            key={`${name}-${i}`}
            d={PATHS[name]}
            transform={`translate(${30 - (BOX_W * scale) / 2} ${y}) scale(${scale})`}
            stroke={color}
            strokeWidth={2 / scale}
            strokeLinecap="square"
            strokeLinejoin="miter"
            fill="none"
          />
        )
      })}
    </>
  )
}
