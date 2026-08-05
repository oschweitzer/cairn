/**
 * Dérive tous les artefacts de thème depuis src/ui/theme.ts.
 *
 *   npm run theme          régénère generated/
 *   npm run theme:check    échoue si generated/ a dérivé de la source
 *   npm run theme:contrast rapport de contraste WCAG seul
 *
 * Sorties :
 *   generated/theme.json        jetons à plat, lus par app.config.ts
 *   generated/theme.css         variables CSS pour la PWA
 *   generated/colors.xml        ressources Android, mode clair (valeurs par défaut)
 *   generated/colors-night.xml  ressources Android, mode sombre
 *
 * Sur le widget, la couleur de rendu vient de theme.ts résolu en JS selon le
 * réglage stocké, ce qui permet de forcer le sombre même quand le système est
 * en clair. Les deux XML servent aux surfaces natives que le JS ne peint pas,
 * l'aperçu du widget dans le sélecteur et l'activité de configuration.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { themes, tagPalette, type Theme, type ThemeName } from '../src/ui/theme'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'generated')

const mode = process.argv[2] ?? '--write'

// ---------------------------------------------------------------- aplatissement

type Flat = Record<string, string>

/** `surface: { page }` devient `surface-page`, pour un nom exploitable partout. */
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

// ------------------------------------------------------------------- couleurs

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

/** Android veut #AARRGGBB, et n'accepte pas la notation rgba(). */
function toAndroidHex(input: string): string {
  const { r, g, b, a } = parseColor(input)
  const p = (n: number) => Math.round(n).toString(16).padStart(2, '0').toUpperCase()
  return `#${p(a * 255)}${p(r)}${p(g)}${p(b)}`
}

/** Aplatit une couleur translucide sur un fond, pour mesurer son contraste réel. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  if (fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/** Luminance relative, WCAG 2.1 formule 1.4.3. */
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

// -------------------------------------------------------- contrôle de contraste

type Check = { theme: ThemeName; fg: string; bg: string; ratio: number; min: number; ok: boolean }

/**
 * Trois seuils, selon ce que l'élément fait réellement.
 *
 * 4,5:1  texte courant, exigence WCAG AA, critère 1.4.3.
 *
 * 3:1    élément d'interface non textuel dont l'apparence porte une information :
 *        puce de couleur d'un tag, bordure d'un champ, anneau de focus.
 *        Exigence WCAG AA, critère 1.4.11.
 *
 * 1,8:1  plancher de perceptibilité du filet décoratif. Ce n'est pas une exigence
 *        WCAG : une couture entre deux strates est décorative au sens du critère
 *        1.4.11, et le contenu d'une carte reste identifiable sans elle. Mais la
 *        séparation de teinte entre strates ne dépasse pas 1,20:1, donc en
 *        pratique c'est ce filet qui dessine le contour de la carte. Le mesurer
 *        empêche qu'il redevienne invisible au fil des retouches.
 *
 * Le seuil réel appliqué est légèrement au-dessus de la norme, pour qu'un arrondi
 * hexadécimal ne fasse pas basculer une paire juste sous la barre.
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

    // Texte courant sur chaque strate.
    for (const bg of surfaces) {
      for (const fg of ['text-primary', 'text-secondary', 'text-muted']) add(fg, bg, AA_TEXT)
      for (const fg of ['accent-default', 'accent-pressed']) add(fg, bg, AA_TEXT)
      for (const s of ['state-danger', 'state-success', 'state-warning']) add(s, bg, AA_TEXT)
    }

    // Puce ou état sélectionné sur fond d'accent atténué.
    add('text-primary', 'accent-subtle', AA_TEXT)
    add('accent-default', 'accent-subtle', AA_TEXT)

    // Texte posé sur un aplat d'accent plein.
    add('text-onAccent', 'accent-default', AA_TEXT)
    add('text-onAccent', 'accent-pressed', AA_TEXT)

    // Bordure interactive et anneau de focus : porteuses d'information.
    for (const bg of surfaces) add('line-strong', bg, AA_UI)

    // Couture décorative : plancher de perceptibilité, pas exigence WCAG.
    add('line-hairline', 'surface-card', SEAM_FLOOR)
    add('line-hairline', 'surface-page', SEAM_FLOOR)
    add('line-hairline', 'surface-raised', SEAM_FLOOR)

    // Puces de tag : non textuelles, lues comme des éléments d'interface.
    // Auditées sur les quatre strates, un tag pouvant apparaître dans une modale.
    for (const key of Object.keys(tagPalette)) {
      for (const bg of surfaces) add(`tag-${key}`, bg, AA_UI)
    }
  }
  return checks
}

/**
 * Écart de teinte entre strates. Informatif, mais il explique pourquoi le filet
 * doit rester visible : à 1,13:1, une carte posée sur la page ne se distingue
 * pratiquement pas par sa seule couleur de fond.
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

// ------------------------------------------------------------------ générateurs

function buildJson(): string {
  return (
    JSON.stringify(
      {
        dark: flatten(themes.dark),
        light: flatten(themes.light),
        tags: tagPalette,
        // La feuille de style complète voyage dans le JSON pour qu'app/+html.tsx
        // l'injecte directement, sans dépendre du traitement des imports CSS par
        // Metro et sans réimplémenter la génération côté application.
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

  // Le sombre est la valeur de :root parce que c'est le défaut de l'application,
  // indépendamment du réglage du système. Quand l'utilisateur choisit « système »,
  // c'est le JS qui résout la préférence et pose data-theme avant l'hydratation.
  // Une règle prefers-color-scheme ici entrerait en conflit avec ce choix.
  return [
    '/* Généré par scripts/gen-theme.ts. Ne pas modifier à la main. */',
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
    '<!-- Généré par scripts/gen-theme.ts. Ne pas modifier à la main. -->',
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
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) drifted.push(name)
  }
  console.log('')
  if (drifted.length) {
    console.error(`generated/ a dérivé de la source : ${drifted.join(', ')}`)
    console.error('Lancer `npm run theme` puis committer le résultat.')
    process.exit(1)
  }
  console.log('generated/ est à jour.')
  process.exit(contrastOk ? 0 : 1)
}

mkdirSync(outDir, { recursive: true })
for (const [name, content] of Object.entries(artifacts)) {
  writeFileSync(join(outDir, name), content)
}
console.log('')
console.log(`Écrit dans generated/ : ${Object.keys(artifacts).join(', ')}`)
if (!contrastOk) process.exit(1)
