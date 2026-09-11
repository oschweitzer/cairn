/**
 * Derives every theme artefact from src/ui/theme.ts.
 *
 *   npm run theme          regenerates generated/
 *   npm run theme:check    fails if generated/ has drifted from the source
 *   npm run theme:contrast WCAG contrast report only
 *
 * Outputs:
 *   generated/theme.json        flat tokens, read by app.config.ts
 *   generated/theme.css         CSS variables for the PWA
 *   generated/colors.xml        Android resources, light mode (default values)
 *   generated/colors-night.xml  Android resources, dark mode
 *   modules/cairn-widget/…/res/values{,-night}/colors.xml  the same, in the
 *     widget module, which is compiled against its own resources
 *
 * On the widget, the rendering colour comes from theme.ts resolved in JS
 * according to the stored setting, which allows forcing dark even when the
 * system is light. The two XML files serve the native surfaces JS does not
 * paint, the widget preview in the picker and the configuration activity.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { themes, tagPalette, type Theme, type ThemeName } from '../src/ui/theme'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'generated')

const mode = process.argv[2] ?? '--write'

// ------------------------------------------------------------------ flattening

type Flat = Record<string, string>

/** `surface: { page }` becomes `surface-page`, a name usable everywhere. */
function flatten(theme: Theme): Flat {
  const out: Flat = {}
  for (const [group, value] of Object.entries(theme)) {
    if (typeof value === 'string') {
      if (group !== 'name' && group !== 'scheme') out[group] = value
      continue
    }
    for (const [token, color] of Object.entries(value as Record<string, string>)) {
      out[`${group}-${token}`] = color
    }
  }
  for (const [key, entry] of Object.entries(tagPalette)) {
    out[`tag-${key}`] = entry[theme.name]
  }
  return out
}

// --------------------------------------------------------------------- colours

type Rgba = { r: number; g: number; b: number; a: number }

function parseColor(input: string): Rgba {
  const hex = input.trim()
  if (hex.startsWith('#')) {
    const raw = hex.slice(1)
    const full =
      raw.length === 3
        ? raw
            .split('')
            .map((c) => c + c)
            .join('')
        : raw
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    }
  }
  const m = hex.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/)
  if (!m) throw new Error(`Couleur non reconnue : ${input}`)
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
}

/** Android wants #AARRGGBB, and does not accept the rgba() notation. */
function toAndroidHex(input: string): string {
  const { r, g, b, a } = parseColor(input)
  const p = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
  return `#${p(a * 255)}${p(r)}${p(g)}${p(b)}`
}

/** Flattens a translucent colour onto a background, to measure its real contrast. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/** Relative luminance, WCAG 2.1 formula 1.4.3. */
function luminance(c: Rgba): number {
  const chan = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b)
}

function contrast(fg: string, bg: string): number {
  const bgc = parseColor(bg)
  const fgc = composite(parseColor(fg), bgc)
  const [hi, lo] = [luminance(fgc), luminance(bgc)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

// ------------------------------------------------------------- contrast check

type Check = { theme: ThemeName; fg: string; bg: string; ratio: number; min: number; ok: boolean }

/**
 * Three thresholds, depending on what the element actually does.
 *
 * 4.5:1  running text, WCAG AA requirement, criterion 1.4.3.
 *
 * 3:1    non-text interface element whose appearance carries information: a
 *        tag's colour chip, a field's border, the focus ring. WCAG AA
 *        requirement, criterion 1.4.11.
 *
 * 1.8:1  perceptibility floor for the decorative hairline. It is not a WCAG
 *        requirement: a seam between two strata is decorative in the sense of
 *        criterion 1.4.11, and a card's content stays identifiable without it.
 *        But the tint separation between strata does not exceed 1.20:1, so in
 *        practice this hairline is what draws the card's outline. Measuring it
 *        keeps it from turning invisible again over successive touch-ups.
 *
 * The threshold actually applied is slightly above the standard, so a
 * hexadecimal rounding does not tip a pair just below the bar.
 */
const AA_TEXT = 4.5
const AA_UI = 3
const SEAM_FLOOR = 1.8

function auditContrast(): Check[] {
  const checks: Check[] = []
  const surfaces = ['surface-page', 'surface-card', 'surface-raised', 'surface-recessed']

  for (const themeName of ['dark', 'light'] as ThemeName[]) {
    const t = flatten(themes[themeName])
    const add = (fg: string, bg: string, min: number) => {
      const ratio = contrast(t[fg], t[bg])
      checks.push({ theme: themeName, fg, bg, ratio, min, ok: ratio >= min })
    }

    // Running text on every stratum.
    for (const bg of surfaces) {
      for (const fg of ['text-primary', 'text-secondary', 'text-muted']) add(fg, bg, AA_TEXT)
      for (const fg of ['accent-default', 'accent-pressed']) add(fg, bg, AA_TEXT)
      for (const s of ['state-danger', 'state-success', 'state-warning']) add(s, bg, AA_TEXT)
    }

    // Chip or selected state on a subdued accent background.
    add('text-primary', 'accent-subtle', AA_TEXT)
    add('accent-default', 'accent-subtle', AA_TEXT)

    // Text set on a flat full accent fill.
    add('text-onAccent', 'accent-default', AA_TEXT)
    add('text-onAccent', 'accent-pressed', AA_TEXT)

    // Interactive border and focus ring: they carry information.
    for (const bg of surfaces) add('line-strong', bg, AA_UI)

    // Decorative seam: a perceptibility floor, not a WCAG requirement.
    add('line-hairline', 'surface-card', SEAM_FLOOR)
    add('line-hairline', 'surface-page', SEAM_FLOOR)
    add('line-hairline', 'surface-raised', SEAM_FLOOR)

    // Tag chips: non-textual, read as interface elements. Audited on all four
    // strata, since a tag can appear in a modal.
    for (const key of Object.keys(tagPalette)) {
      for (const bg of surfaces) add(`tag-${key}`, bg, AA_UI)
    }
  }
  return checks
}

/**
 * Tint difference between strata. Informational, but it explains why the
 * hairline has to stay visible: at 1.13:1, a card set on the page can hardly be
 * told apart by its background colour alone.
 */
function reportStrata(): void {
  for (const themeName of ['dark', 'light'] as ThemeName[]) {
    const s = themes[themeName].surface
    const pairs: [string, number][] = [
      ['card/page', contrast(s.card, s.page)],
      ['raised/card', contrast(s.raised, s.card)],
      ['recessed/page', contrast(s.recessed, s.page)],
    ]
    console.log(
      `  ${themeName.padEnd(5)} ` + pairs.map(([n, r]) => `${n} ${r.toFixed(2)}:1`).join('   '),
    )
  }
}

function reportContrast(checks: Check[]): boolean {
  const failed = checks.filter((c) => !c.ok)
  const byTheme = (name: ThemeName) => checks.filter((c) => c.theme === name)

  for (const themeName of ['dark', 'light'] as ThemeName[]) {
    const list = byTheme(themeName)
    const bad = list.filter((c) => !c.ok)
    const worst = [...list].sort((a, b) => a.ratio - b.ratio)[0]
    console.log(
      `  ${themeName.padEnd(5)} ${list.length - bad.length}/${list.length} paires conformes` +
        `   plus faible : ${worst.fg} sur ${worst.bg} à ${worst.ratio.toFixed(2)}:1`,
    )
  }

  if (failed.length) {
    console.log('')
    for (const c of failed) {
      console.log(
        `  ÉCHEC  ${c.theme.padEnd(5)} ${c.fg} sur ${c.bg}` +
          `  ${c.ratio.toFixed(2)}:1  attendu ${c.min}:1`,
      )
    }
  }
  return failed.length === 0
}

// ------------------------------------------------------------------- generators

function buildJson(): string {
  return (
    JSON.stringify(
      {
        dark: flatten(themes.dark),
        light: flatten(themes.light),
        tags: tagPalette,
        // The complete stylesheet travels in the JSON so app/+html.tsx injects
        // it directly, without depending on how Metro handles CSS imports and
        // without reimplementing the generation on the app side.
        css: buildCss(),
      },
      null,
      2,
    ) + '\n'
  )
}

function buildCss(): string {
  const vars = (theme: Theme) =>
    Object.entries(flatten(theme))
      .map(([k, v]) => `  --cairn-${k}: ${v};`)
      .join('\n')

  // Dark is the :root value because it is the app's default, regardless of the
  // system setting. When the user picks "system", JS resolves the preference and
  // sets data-theme before hydration. A prefers-color-scheme rule here would
  // conflict with that choice.
  return [
    '/* Generated by scripts/gen-theme.ts. Do not edit by hand. */',
    ':root {',
    '  color-scheme: dark;',
    vars(themes.dark),
    '}',
    '',
    ':root[data-theme="light"] {',
    '  color-scheme: light;',
    vars(themes.light),
    '}',
    '',
  ].join('\n')
}

function buildXml(theme: Theme): string {
  const entries = Object.entries(flatten(theme))
    .map(([k, v]) => `  <color name="cairn_${k.replace(/-/g, '_')}">${toAndroidHex(v)}</color>`)
    .join('\n')
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated by scripts/gen-theme.ts. Do not edit by hand. -->',
    '<resources>',
    entries,
    '</resources>',
    '',
  ].join('\n')
}

// ------------------------------------------------------------------------ main

const artifacts: Record<string, string> = {
  'theme.json': buildJson(),
  'theme.css': buildCss(),
  'colors.xml': buildXml(themes.light),
  'colors-night.xml': buildXml(themes.dark),
}

/**
 * The same colours, placed in the widget module.
 *
 * It is not a convenience copy: an Android library is compiled against its own
 * resources, not those of the app that embeds it. A widget layout saying
 * `@color/cairn_surface_page` without the colour existing *in the module* would
 * not compile — the error arrives when the package is built, long after the
 * work was thought to be done.
 *
 * Writing them here rather than by hand keeps a single source: a tint changed
 * in theme.ts spreads to the widget through `npm run theme`, and
 * `npm run theme:check` refuses to let the two diverge.
 */
const widgetRes = join(root, 'modules', 'cairn-widget', 'android', 'src', 'main', 'res')
const widgetArtifacts: Record<string, string> = {
  [join(widgetRes, 'values', 'colors.xml')]: artifacts['colors.xml'],
  [join(widgetRes, 'values-night', 'colors.xml')]: artifacts['colors-night.xml'],
}

console.log('Écart entre strates')
reportStrata()
console.log('')
console.log('Contraste WCAG')
const contrastOk = reportContrast(auditContrast())

if (mode === '--contrast') {
  process.exit(contrastOk ? 0 : 1)
}

if (mode === '--check') {
  const drifted: string[] = []
  for (const [name, content] of Object.entries(artifacts)) {
    const path = join(outDir, name)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) drifted.push(`generated/${name}`)
  }
  for (const [path, content] of Object.entries(widgetArtifacts)) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      drifted.push(path.slice(root.length + 1))
    }
  }
  console.log('')
  if (drifted.length) {
    console.error(`Les ressources dérivées du thème ont dérivé : ${drifted.join(', ')}`)
    console.error('Lancer `npm run theme` puis committer le résultat.')
    process.exit(1)
  }
  console.log('Les ressources dérivées du thème sont à jour.')
  process.exit(contrastOk ? 0 : 1)
}

mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(artifacts)) {
  writeFileSync(join(outDir, name), content)
}
for (const [path, content] of Object.entries(widgetArtifacts)) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
console.log('')
console.log(`Écrit dans generated/ : ${Object.keys(artifacts).join(', ')}`)
console.log('Écrit dans modules/cairn-widget/ : values/colors.xml, values-night/colors.xml')
if (!contrastOk) process.exit(1)
