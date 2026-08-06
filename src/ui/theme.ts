/**
 * Source unique de vérité pour les couleurs, la typographie et les formes de Cairn.
 *
 * Ce fichier ne doit importer AUCUN module react-native. Il est lu par trois
 * consommateurs qui n'ont pas le même environnement d'exécution :
 *   - l'application (Android et web) via src/ui/ThemeProvider.tsx
 *   - scripts/gen-theme.ts sous Node, qui en dérive le CSS web et les
 *     ressources de couleurs du widget Android
 *   - app.config.ts, indirectement via generated/theme.json
 *
 * Toute couleur ajoutée ici se propage aux trois surfaces sans recopie.
 *
 * ── Registre nordique ────────────────────────────────────────────────────────
 * L'identité est celle de la pierre levée du Nord, pas du calcaire du Quercy.
 * La pierre reste, mais elle change de lumière : le gneiss bleu-gris sous une
 * nuit polaire, la neige sur le granit au jour. Trois conséquences concrètes,
 * qui expliquent la plupart des valeurs ci-dessous.
 *
 * 1. Les gris sont froids. Toutes les strates tournent autour de 200° de teinte,
 *    là où la palette précédente tournait autour de 30°.
 * 2. L'accent est l'aurore, un vert-cyan glacial. Il ne peut pas être le rouge
 *    des runes peintes à l'ocre : cette place est déjà prise par `state.danger`,
 *    et deux rouges dans une interface, l'un décoratif l'autre porteur d'alerte,
 *    est une confusion qu'aucune nuance ne rattrape.
 * 3. Les angles sont plus vifs. La roche est taillée au ciseau, pas roulée par
 *    la rivière. Voir `radius`.
 */

export type ThemeName = 'dark' | 'light'

/**
 * Les jetons portent des noms de rôle, jamais des noms de couleur.
 * `surface.recessed` reste valable si l'aurore devient une braise un jour,
 * `vertGlacial` ne survivrait pas au premier changement de palette.
 */
export type Theme = {
  name: ThemeName
  /** Ce que voit le système d'exploitation, pour la barre d'état et le fond racine. */
  scheme: 'dark' | 'light'
  surface: {
    /** Fond de page, la strate la plus profonde. */
    page: string
    /** Carte de note posée sur la page. */
    card: string
    /** Élévation supérieure, modale et feuille glissante. */
    raised: string
    /** Creusé dans la roche, champ de saisie et coffre. */
    recessed: string
  }
  line: {
    /** Couture géologique d'un pixel, remplace l'ombre portée. */
    hairline: string
    /** Bordure appuyée, survol et focus. */
    strong: string
  }
  text: {
    primary: string
    secondary: string
    muted: string
    /** Texte posé sur un aplat d'accent. */
    onAccent: string
  }
  accent: {
    default: string
    pressed: string
    /** Fond teinté très léger pour les puces et les états sélectionnés. */
    subtle: string
  }
  state: {
    danger: string
    success: string
    warning: string
  }
  /** Voile derrière les modales. */
  overlay: string
}

/**
 * Nuit polaire sur le gneiss. C'est le thème appliqué par défaut.
 *
 * Toutes les valeurs ci-dessous sont issues d'une résolution sous contrainte de
 * contraste, pas d'un choix à l'œil. `npm run theme:contrast` rejoue la preuve.
 * Les modifier à la main sans relancer l'audit casse très probablement l'AA.
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
    // Même constat qu'en registre minéral : les strates ne peuvent pas s'écarter
    // davantage sans virer au gris de bureau et perdre le caractère de pierre.
    // C'est donc cette couture qui porte le contour de la carte, d'où un filet
    // nettement plus affirmé que l'écart entre les fonds qu'elle sépare.
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

/** Neige tassée sur le granit, plutôt que blanc. */
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
    // Assombri jusqu'à tenir 3:1 sur les quatre strates, la surface creusée
    // étant la plus exigeante puisque c'est la plus foncée du thème clair.
    strong: '#5F6E73',
  },
  text: {
    primary: '#161C1E',
    secondary: '#333D40',
    muted: '#4E585C',
    onAccent: '#FAFCFC',
  },
  accent: {
    // Bien plus foncé que la variante sombre : l'aurore telle qu'on la voit dans
    // le ciel ne tiendrait aucun contraste sur de la neige. C'est la même teinte,
    // ramenée à la clarté qu'exige la surface creusée, la plus dure des quatre.
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
 * Palette de tags nordique. Dix teintes réparties sur le cercle chromatique et
 * désaturées de façon homogène, pour qu'aucun tag ne crie plus fort qu'un autre.
 *
 * Chaque entrée est une teinte unique déclinée en deux clartés. Les valeurs sont
 * dérivées d'un couple teinte et chroma constant en OKLCH, dont seule la clarté
 * varie selon le thème. React Native n'accepte pas `oklch()` dans les styles,
 * donc les deux variantes sont figées ici en hexadécimal.
 *
 * La base de données stocke la clé (`ambre`), jamais l'hexadécimal. Sinon le
 * thème clair ne pourrait pas remapper la couleur et la palette serait figée à
 * vie. Les clés sont aussi les valeurs du type `tag_color` en base : les
 * renommer demande une migration, voir
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
 * Même couleur, rendue transparente.
 *
 * Sert aux halos de survol : un aplat d'accent à pleine opacité écraserait le
 * glyphe qu'il est censé mettre en valeur. La palette reste la source, on ne
 * fait qu'en diluer une valeur — aucune teinte nouvelle n'entre par cette porte,
 * et l'audit de contraste garde donc son sens.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Résout une clé de palette vers l'hexadécimal du thème actif. */
export function resolveTagColor(key: TagColorKey, theme: ThemeName): string {
  return tagPalette[key][theme]
}

/**
 * Noms de familles tels qu'exposés par les paquets @expo-google-fonts.
 *
 * Grenze est une antique aux fûts droits et aux terminaisons taillées en biseau,
 * la plus proche d'un tracé gravé que propose une police lisible. Elle ne sert
 * qu'au logotype et aux titres de section, en capitales.
 * Alegreya est un serif humaniste conçu pour la lecture longue, aux angles moins
 * arrondis que la moyenne, il porte le contenu.
 * Archivo habille l'interface, où un serif à 11 points nuirait à la lisibilité.
 *
 * Les runes elles-mêmes ne sont pas typographiques. Le bloc Runique d'Unicode
 * n'est présent dans presque aucune police système, un ᚱ posé dans un Text
 * donnerait un rectangle vide sur la majorité des appareils. Elles sont donc
 * tracées en vectoriel, voir src/ui/runes.tsx.
 */
export const fonts = {
  display: 'Grenze_500Medium',
  displayMedium: 'Grenze_600SemiBold',
  serif: 'Alegreya_400Regular',
  serifMedium: 'Alegreya_500Medium',
  sans: 'Archivo_400Regular',
  sansMedium: 'Archivo_500Medium',
} as const

export const type = {
  /** Logotype et titres d'écran, en capitales espacées. */
  display: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, letterSpacing: 3.2 },
  /** Titre de note dans la grille. */
  title: { fontFamily: fonts.serifMedium, fontSize: 18, lineHeight: 24 },
  /** Corps de note et éléments de liste. Alegreya a un œil plus petit que
   *  Spectral à taille égale, d'où le point gagné pour tenir la même lisibilité. */
  body: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24 },
  /** Onglets, boutons, noms de tags. */
  label: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  /** Horodatages et métadonnées. Plancher de lisibilité, ne pas descendre plus bas. */
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
} as const

/**
 * Angles taillés au ciseau. La pierre levée n'a pas été roulée par la rivière :
 * les arêtes sont franches, juste assez adoucies pour ne pas couper l'œil.
 * Ce sont volontairement des valeurs plus basses que la convention mobile.
 */
export const radius = { sm: 2, md: 4, lg: 6, xl: 9, pill: 999 } as const

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const

/**
 * La pierre ne fait pas ressort, et le ciseau ne traîne pas. Départ franc,
 * arrêt net, sur des durées plus courtes que la palette minérale : là où le
 * registre précédent cherchait le posé, celui-ci cherche le frappé.
 */
export const motion = {
  fast: 120,
  base: 190,
  slow: 240,
  /** Courbe de Bézier à départ vif et arrêt ferme, pour Reanimated ou `transition-timing-function`. */
  easing: [0.12, 0.8, 0.24, 1] as const,
} as const

/** Contraintes propres au widget Android, rappelées ici pour éviter la dérive. */
export const widgetConstraints = {
  /** Le widget se pose sur un fond d'écran inconnu, son fond est donc toujours opaque. */
  opaqueBackground: true,
  headerFontSize: 15,
  itemFontSize: 13,
  minTouchTarget: 48,
} as const
