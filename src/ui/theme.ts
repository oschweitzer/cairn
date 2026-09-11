/**
 * Single source of truth for Cairn's colours, typography and shapes.
 *
 * This file must import NO react-native module. It is read by three consumers
 * that do not share the same runtime:
 *   - the app (Android and web) through src/ui/ThemeProvider.tsx
 *   - scripts/gen-theme.ts under Node, which derives the web CSS and the Android
 *     widget's colour resources from it
 *   - app.config.ts, indirectly through generated/theme.json
 *
 * Any colour added here spreads to all three surfaces without copying.
 *
 * ── Nordic register ──────────────────────────────────────────────────────────
 * The identity is the standing stone of the North, not the limestone of the
 * Quercy. The stone stays, but its light changes: blue-grey gneiss under a polar
 * night, snow on granite by day. Three concrete consequences, which explain most
 * of the values below.
 *
 * 1. The greys are cold. All the strata sit around a 200° hue, where the
 *    previous palette sat around 30°.
 * 2. The accent is the aurora, an icy green-cyan. It cannot be the red of runes
 *    painted in ochre: that place is already taken by `state.danger`, and two
 *    reds in one interface, one decorative and the other carrying alerts, is a
 *    confusion no shade can make up for.
 * 3. The corners are sharper. The rock is cut with a chisel, not rolled by the
 *    river. See `radius`.
 */

export type ThemeName = 'dark' | 'light'

/**
 * Tokens carry role names, never colour names. `surface.recessed` still holds
 * if the aurora turns into an ember one day; `vertGlacial` would not survive the
 * first palette change.
 */
export type Theme = {
  name: ThemeName
  /** What the operating system sees, for the status bar and the root background. */
  scheme: 'dark' | 'light'
  surface: {
    /** Page background, the deepest stratum. */
    page: string
    /** Note card set on the page. */
    card: string
    /** Upper elevation, modal and bottom sheet. */
    raised: string
    /** Carved into the rock, text field and vault. */
    recessed: string
  }
  line: {
    /** One-pixel geological seam, stands in for the drop shadow. */
    hairline: string
    /** Emphasised border, hover and focus. */
    strong: string
  }
  text: {
    primary: string
    secondary: string
    muted: string
    /** Text set on a flat accent fill. */
    onAccent: string
  }
  accent: {
    default: string
    pressed: string
    /** Very light tinted background for chips and selected states. */
    subtle: string
  }
  state: {
    danger: string
    success: string
    warning: string
  }
  /** Veil behind modals. */
  overlay: string
}

/**
 * Polar night on gneiss. This is the theme applied by default.
 *
 * Every value below comes out of solving under contrast constraints, not from
 * picking by eye. `npm run theme:contrast` replays the proof. Changing them by
 * hand without rerunning the audit very probably breaks AA.
 */
const dark: Theme = {
  name: 'dark',
  scheme: 'dark',
  surface: {
    page: '#0D1214',
    card: '#161E22',
    raised: '#212C31',
    recessed: '#070A0B',
  },
  line: {
    // Same finding as in the mineral register: the strata cannot move further
    // apart without turning into office grey and losing the character of stone.
    // So this seam is what carries the card's outline, hence a hairline much
    // bolder than the difference between the backgrounds it separates.
    hairline: '#5C6E75',
    strong: '#7C9099',
  },
  text: {
    primary: '#E3EAEC',
    secondary: '#B0BDC2',
    muted: '#8A989E',
    onAccent: '#0D1214',
  },
  accent: {
    default: '#6BCFAB',
    pressed: '#54B492',
    subtle: '#12241F',
  },
  state: {
    danger: '#DE868C',
    success: '#A5BD72',
    warning: '#DFA85F',
  },
  overlay: 'rgba(5, 8, 9, 0.74)',
}

/** Packed snow on granite, rather than white. */
const light: Theme = {
  name: 'light',
  scheme: 'light',
  surface: {
    page: '#DCE3E4',
    card: '#F0F4F5',
    raised: '#FAFCFC',
    recessed: '#C6D0D2',
  },
  line: {
    hairline: '#94A3A8',
    // Darkened until it holds 3:1 on all four strata, the recessed surface being
    // the most demanding since it is the darkest of the light theme.
    strong: '#5F6E73',
  },
  text: {
    primary: '#161C1E',
    secondary: '#333D40',
    muted: '#4E585C',
    onAccent: '#FAFCFC',
  },
  accent: {
    // Much darker than the dark variant: the aurora as seen in the sky would
    // hold no contrast on snow. It is the same hue, brought down to the
    // lightness the recessed surface demands, the hardest of the four.
    default: '#155C4A',
    pressed: '#114E3F',
    subtle: '#CBDFD8',
  },
  state: {
    danger: '#8E2A33',
    success: '#465A20',
    warning: '#77490F',
  },
  overlay: 'rgba(22, 28, 30, 0.45)',
}

export const themes: Record<ThemeName, Theme> = { dark, light }

/**
 * Nordic tag palette. Ten hues spread around the colour wheel and evenly
 * desaturated, so that no tag shouts louder than another.
 *
 * Each entry is a single hue in two lightnesses. The values are derived from a
 * constant hue and chroma pair in OKLCH, of which only the lightness varies with
 * the theme. React Native does not accept `oklch()` in styles, so both variants
 * are frozen here in hexadecimal.
 *
 * The database stores the key (`ambre`), never the hexadecimal. Otherwise the
 * light theme could not remap the colour and the palette would be frozen for
 * life. The keys are also the values of the `tag_color` type in the database:
 * renaming them takes a migration, see
 * supabase/migrations/20260806090000_nordic_tag_colors.sql.
 */
export const tagPalette = {
  ambre: { label: 'Ambre', dark: '#DFB369', light: '#6F4E0F' },
  braise: { label: 'Braise', dark: '#DB8452', light: '#8A3D1A' },
  airelle: { label: 'Airelle', dark: '#D4737C', light: '#89303A' },
  bruyere: { label: 'Bruyère', dark: '#A98BC4', light: '#59417A' },
  fjord: { label: 'Fjord', dark: '#6E9AC4', light: '#2A5079' },
  aurore: { label: 'Aurore', dark: '#5DC6A4', light: '#125C4A' },
  lichen: { label: 'Lichen', dark: '#A5BD72', light: '#495C25' },
  fer: { label: 'Fer', dark: '#96A0A6', light: '#4F585D' },
  bouleau: { label: 'Bouleau', dark: '#D2CCBD', light: '#5A5548' },
  granit: { label: 'Granit', dark: '#8393A0', light: '#3C4750' },
} as const

export type TagColorKey = keyof typeof tagPalette

export const tagColorKeys = Object.keys(tagPalette) as TagColorKey[]

/**
 * The same colour, made transparent.
 *
 * Used for hover glows: a flat accent fill at full opacity would crush the glyph
 * it is meant to set off. The palette stays the source, we only dilute one of
 * its values — no new hue comes in through this door, so the contrast audit
 * keeps its meaning.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Resolves a palette key to the active theme's hexadecimal. */
export function resolveTagColor(key: TagColorKey, theme: ThemeName): string {
  return tagPalette[key][theme]
}

/**
 * Family names as exposed by the @expo-google-fonts packages.
 *
 * Viking carries the logotype and section headings, in capitals. It is a
 * display face, and it stays confined to that role: its shapes hold up neither
 * to long reading nor to the eleven points of a tab label. It is bundled from
 * assets/fonts, licence next to the file — free to use, modification and
 * redistribution forbidden.
 * Junicode carries the content. It is a Renaissance serif drawn for scholarly
 * editions of medieval texts: it is made to be read at length, and its Latin
 * coverage is immense — which matters less here, but says enough about the care
 * put into it. Under the SIL Open Font licence, full text in assets/fonts.
 * Archivo dresses the interface, where a serif at 11 points would hurt
 * readability.
 *
 * The runes themselves are not typographic. Unicode's Runic block is present in
 * almost no system font; a ᚱ set in a Text would give an empty rectangle on most
 * devices. So they are drawn as vectors, see src/ui/runes.tsx.
 */
export const fonts = {
  // A single weight: Viking offers no other. So both tokens point to the same
  // place, rather than suggesting a variant that does not exist.
  display: 'Viking',
  displayMedium: 'Viking',
  serif: 'Junicode',
  serifMedium: 'Junicode-Bold',
  sans: 'Archivo_400Regular',
  sansMedium: 'Archivo_500Medium',
} as const

export const type = {
  /** Logotype and screen titles, in spaced capitals. */
  display: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, letterSpacing: 3.2 },
  /** Note title in the grid. */
  title: { fontFamily: fonts.serifMedium, fontSize: 19, lineHeight: 26 },
  /**
   * Note body and list items.
   *
   * One point more than with Alegreya, and it is not an adjustment by eye:
   * Junicode's x-height measures 0.418 em against 0.456, 8% less. At the same
   * size the text would look smaller, when it is the same reading. The
   * computation gives 17.5; we keep 17, the half size not being visible and
   * whole numbers carrying better into line heights.
   */
  body: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 26 },
  /**
   * Tabs, buttons, tag names. Stays sans, and that is a choice: these are
   * commands, not prose. A serif would lose sharpness there at fourteen points,
   * and the change of font marks precisely the boundary between what you read
   * and what you press.
   */
  label: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  /**
   * Explanations, timestamps, metadata. Moved to the serif: they are sentences,
   * not commands, and Settings is made almost entirely of them. One point gained
   * for the same reason as the body, the smaller x-height weighing even more at
   * this size.
   */
  caption: { fontFamily: fonts.serif, fontSize: 13, lineHeight: 18, letterSpacing: 0.2 },
} as const

/**
 * Chisel-cut corners. The standing stone was not rolled by the river: the edges
 * are clean, softened just enough not to cut the eye. These are deliberately
 * lower values than the mobile convention.
 */
export const radius = { sm: 2, md: 4, lg: 6, xl: 9, pill: 999 } as const

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const

/**
 * Stone does not spring, and the chisel does not linger. A sharp start, a clean
 * stop, over shorter durations than the mineral palette: where the previous
 * register looked for poise, this one looks for a strike.
 */
export const motion = {
  fast: 120,
  base: 190,
  slow: 240,
  /** Bézier curve with a brisk start and a firm stop, for Reanimated or `transition-timing-function`. */
  easing: [0.12, 0.8, 0.24, 1] as const,
} as const

/** Constraints specific to the Android widget, restated here to prevent drift. */
export const widgetConstraints = {
  /** The widget sits on an unknown wallpaper, so its background is always opaque. */
  opaqueBackground: true,
  headerFontSize: 15,
  itemFontSize: 13,
  minTouchTarget: 48,
} as const
