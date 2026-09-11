import type { ColorValue } from 'react-native'
import Svg, { Path } from 'react-native-svg'

/**
 * Functional pictograms Feather does not provide, drawn on its grid.
 *
 * Nothing to do with the runes of src/ui/runes.tsx, which are ornamental and
 * never carry meaning: these are interface icons in the same way as the trash,
 * and read as such.
 *
 * ── Why draw them rather than borrow another family ──────────────────────────
 * MaterialCommunityIcons does have a chest, and @expo/vector-icons already
 * bundles it. But its stroke is bolder and its shapes fuller: set next to a
 * Feather `check-circle` in the same bar, it does not read as a neighbour, it
 * reads as a patch. One more icon is not worth breaking a family's unity.
 *
 * Feather's grid is reproducible: a 24 box, a stroke of 2, rounded ends and
 * joins, no fill. The paths below stick to it, and the stroke width follows the
 * requested size as Feather's does, otherwise an enlarged glyph would look drawn
 * more finely than its neighbours.
 */

const BOX = 24

const GLYPHS = {
  /**
   * Chest. A domed lid, a body with softened bottom corners, a hasp in the
   * middle.
   *
   * The dome is not decorative: a box with a flat lid gets confused with a box or
   * an archive, two icons already used elsewhere in the app. The curve is what
   * makes it a chest.
   */
  chest: [
    // Lid: an arc from (3,9) to (21,9), peaking at 4.
    'M3 9 a9 5 0 0 1 18 0',
    // Body: the top edge serves as a band between lid and body.
    'M3 9 h18 v9 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z',
    // Hasp, under the band.
    'M12 9 v4',
  ],

  /**
   * Strikethrough. Built exactly like Feather's `underline` — an arch topped by
   * a stroke — but the stroke runs through the middle instead of underneath.
   * That is the only difference, and it is what makes the two buttons read as a
   * pair in the format bar.
   */
  strikethrough: ['M6 4 v5 a6 6 0 0 0 12 0 V4', 'M4 11 h16'],

  /**
   * Heading and subheading: the same letter at two sizes.
   *
   * An "H1" and an "H2" would be more precise and unreadable at sixteen points,
   * the digit's height falling below the stroke width. Two A's of different sizes
   * are understood without being deciphered, which is the only criterion that
   * counts for a pictogram.
   */
  letterLarge: ['M4 20 L12 5 L20 20', 'M7.4 14 H16.6'],
  letterSmall: ['M7 19 L12 9 L17 19', 'M9.2 15.4 H14.8'],
} as const

export type GlyphName = keyof typeof GLYPHS

export const glyphNames = Object.keys(GLYPHS) as GlyphName[]

export function isGlyphName(name: string): name is GlyphName {
  return name in GLYPHS
}

export function Glyph({
  name,
  size = 20,
  color,
}: {
  name: GlyphName
  size?: number
  /**
   * `ColorValue` and not `string`: react-navigation passes the tab's tint as
   * that type, which also covers opaque platform colours. It is exactly what
   * `react-native-svg` expects for `stroke`, so there is nothing to convert.
   */
  color: ColorValue
}) {
  // Feather draws at 2 units on a 24 box, whatever the rendered size: so the
  // apparent thickness follows the scale, and the glyph stays a sibling of
  // those around it.
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
      {GLYPHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  )
}
