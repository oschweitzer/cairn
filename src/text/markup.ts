/**
 * Mise en forme du texte des notes, et reconnaissance des liens.
 *
 * ── Pourquoi un balisage dans le texte, et pas des colonnes ──────────────────
 * Le corps d'une note et le contenu d'un élément de liste sont des colonnes
 * `text`, et ils le restent. Ce n'est pas une économie de migration : c'est ce
 * qui garde tout le reste intact.
 *
 * Le coffre chiffre une chaîne, une seule, par note — un document structuré
 * demanderait de rouvrir le format scellé. La recherche plein texte de Postgres
 * indexe `title || body`. L'export vers Google Agenda recopie le corps dans la
 * description d'un évènement. Et un jour où quelque chose affichera ce texte
 * sans le rendre — un export, une notification, une sauvegarde — `**gras**` se
 * lit encore, là où un JSON de spans ne se lirait pas.
 *
 * D'où le choix d'une syntaxe déjà connue plutôt que d'une invention.
 *
 * ── La syntaxe ───────────────────────────────────────────────────────────────
 *
 *   **gras**        *italique*        ~~barré~~        __souligné__
 *   # grand titre   ## sous-titre     - élément de liste à puces
 *   [libellé](https://exemple.fr)     et toute URL écrite au fil du texte
 *
 * `__` est un écart assumé par rapport à CommonMark, où il vaut gras. Il n'y a
 * pas de souligné en Markdown, il fallait donc prendre une marque quelque part,
 * et un double tiret bas ressemble à ce qu'il produit. Le gras garde `**`, qui
 * est la forme qu'écrivent les gens.
 *
 * ── Pourquoi ce module ne connaît ni React ni react-native ───────────────────
 * Il rend une structure, pas des composants. C'est ce qui permet de le tester
 * sous Node par `npm run test:logic`, et c'est là que vivent les erreurs qui
 * comptent : une URL coupée au mauvais endroit, un `*` isolé qui avale la fin
 * d'une ligne, une recherche qui ne trouve plus un mot devenu gras.
 */

export type Marks = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

/** Fragment de texte homogène. `href` en fait un lien. */
export type Span = Marks & {
  text: string
  href?: string
}

export type Block = {
  kind: 'paragraph' | 'bullet'
  /** 0 corps, 1 grand titre, 2 sous-titre. Toujours 0 sur une puce. */
  level: 0 | 1 | 2
  spans: Span[]
}

/**
 * Marques d'emphase, dans l'ordre où elles sont essayées.
 *
 * L'ordre n'est pas décoratif : sur `**gras**`, la règle de l'italique trouve
 * elle aussi une correspondance à la position zéro — un `*`, du texte, un `*` —
 * et capturerait `*gras`. À égalité de position, c'est donc la première déclarée
 * qui gagne, et le gras doit passer avant l'italique.
 */
const EMPHASES: { open: string; close: string; mark: keyof Marks }[] = [
  { open: '**', close: '**', mark: 'bold' },
  { open: '~~', close: '~~', mark: 'strike' },
  { open: '__', close: '__', mark: 'underline' },
  { open: '*', close: '*', mark: 'italic' },
]

/**
 * Lien nommé. Le libellé s'arrête au premier crochet fermant, l'adresse à la
 * première parenthèse fermante : personne n'écrit à la main un lien qui en
 * contient, et une expression permissive coûterait ici bien plus qu'elle ne
 * rapporte.
 */
const NAMED_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+)\)/

/**
 * URL écrite au fil du texte.
 *
 * `www.` sans protocole est reconnu : c'est ce que les gens collent, et le
 * refuser laisserait la moitié des liens inertes. La classe finale exclut la
 * ponctuation courante pour que « voir https://exemple.fr. » ne fasse pas du
 * point final un morceau de l'adresse — erreur classique, et invisible jusqu'au
 * jour où le lien ne s'ouvre pas.
 */
const BARE_LINK = /(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/

/** Complète une adresse écrite sans protocole. */
export function normalizeHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

type Found = {
  index: number
  length: number
  /** Contenu à analyser à son tour, avec la marque ajoutée. */
  inner: string
  marks: Marks
  href?: string
  /**
   * Texte à afficher tel quel, sans être réanalysé. Sert aux liens nus : les
   * points et les barres obliques d'une adresse ne sont pas du balisage, et
   * `www.exemple.fr` doit rester écrit ainsi même si le lien pointe sur
   * `https://www.exemple.fr`.
   */
  literal?: string
}

/** Première marque rencontrée dans la ligne, ou `null` s'il n'y en a plus. */
function findNext(line: string): Found | null {
  let best: Found | null = null

  const consider = (candidate: Found) => {
    // Strictement plus tôt : à égalité, la marque déjà retenue gagne, ce qui
    // fait respecter l'ordre de déclaration ci-dessus.
    if (!best || candidate.index < best.index) best = candidate
  }

  const named = NAMED_LINK.exec(line)
  if (named) {
    consider({
      index: named.index,
      length: named[0].length,
      inner: named[1],
      marks: {},
      href: normalizeHref(named[2]),
    })
  }

  // Un lien nommé commence par `[`, un lien nu par `h` ou `w` : les deux ne
  // peuvent pas débuter au même endroit, il n'y a donc rien à arbitrer entre eux.
  const bare = BARE_LINK.exec(line)
  if (bare) {
    consider({
      index: bare.index,
      length: bare[0].length,
      inner: '',
      literal: bare[0],
      marks: {},
      href: normalizeHref(bare[0]),
    })
  }

  for (const { open, close, mark } of EMPHASES) {
    const start = line.indexOf(open)
    if (start === -1) continue
    const from = start + open.length
    let end = line.indexOf(close, from)
    // Il faut au moins un caractère entre les deux marques : `****` n'est pas
    // du gras vide, c'est du texte.
    if (end === -1 || end === from) continue

    /**
     * Sur une marque de deux caractères, la fermeture se prend à la fin de la
     * suite de marques, pas à son début.
     *
     * `**gras et *ital***` finit sur trois astérisques : le premier ferme
     * l'italique intérieur, les deux suivants le gras. Une recherche naïve
     * prenait les deux premiers, laissait l'italique ouvert, et rendait le
     * troisième astérisque en toutes lettres à l'écran.
     */
    if (close.length === 2) {
      while (line[end + 2] === close[0]) end++
    }

    consider({
      index: start,
      length: end + close.length - start,
      inner: line.slice(from, end),
      marks: { [mark]: true },
    })
  }

  return best
}

/** Découpe une ligne en fragments homogènes. */
export function parseInline(line: string, inherited: Marks = {}): Span[] {
  const spans: Span[] = []
  let rest = line

  while (rest.length > 0) {
    const found = findNext(rest)
    if (!found) break

    if (found.index > 0) {
      spans.push({ ...inherited, text: rest.slice(0, found.index) })
    }

    if (found.href) {
      // Le libellé peut être mis en forme, l'adresse non. Chaque fragment issu
      // du libellé emporte l'adresse : c'est ce qui rend tout le lien cliquable
      // quand une partie seulement est en gras.
      const label = found.literal
        ? [{ text: found.literal }]
        : parseInline(found.inner, inherited)
      for (const span of label) {
        spans.push({ ...inherited, ...span, href: found.href })
      }
    } else {
      spans.push(...parseInline(found.inner, { ...inherited, ...found.marks }))
    }

    rest = rest.slice(found.index + found.length)
  }

  if (rest.length > 0) spans.push({ ...inherited, text: rest })
  return spans
}

/**
 * Découpe un texte en blocs.
 *
 * Les lignes vides sont conservées comme paragraphes vides : elles portent
 * l'aération voulue par qui a écrit la note, et les avaler resserrerait le
 * texte à l'affichage sans que rien ne l'explique.
 */
export function parseMarkup(source: string | null | undefined): Block[] {
  if (!source) return []

  return source.split('\n').map((raw): Block => {
    if (raw.startsWith('## ')) {
      return { kind: 'paragraph', level: 2, spans: parseInline(raw.slice(3)) }
    }
    if (raw.startsWith('# ')) {
      return { kind: 'paragraph', level: 1, spans: parseInline(raw.slice(2)) }
    }
    // Le point médian est accepté à l'entrée parce que c'est ce que rend
    // l'affichage : recopier une puce depuis une note affichée doit marcher.
    if (raw.startsWith('- ') || raw.startsWith('• ')) {
      return { kind: 'bullet', level: 0, spans: parseInline(raw.slice(2)) }
    }
    return { kind: 'paragraph', level: 0, spans: parseInline(raw) }
  })
}

/**
 * Le texte sans son balisage.
 *
 * Sert à la recherche, aux estimations de hauteur et à tout ce qui compte des
 * caractères. Sans lui, chercher « courses » ne trouvait plus une note où le mot
 * avait été mis en gras : le haystack contenait `**courses**`, ce qui marche par
 * chance, mais « liste de courses » écrit `liste de **courses**` ne se trouvait
 * plus du tout.
 */
export function plainText(source: string | null | undefined): string {
  return parseMarkup(source)
    .map((block) => {
      const text = block.spans.map((span) => span.text).join('')
      return block.kind === 'bullet' ? `• ${text}` : text
    })
    .join('\n')
}

// --------------------------------------------------------------- édition

export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'bullet' | 'title' | 'subtitle'

export type Selection = { start: number; end: number }

/** Résultat d'une commande de mise en forme : le nouveau texte et où poser le curseur. */
export type Edit = { text: string; selection: Selection }

const WRAPPERS: Record<'bold' | 'italic' | 'underline' | 'strike', string> = {
  bold: '**',
  italic: '*',
  underline: '__',
  strike: '~~',
}

const PREFIXES: Record<'bullet' | 'title' | 'subtitle', string> = {
  bullet: '- ',
  title: '# ',
  subtitle: '## ',
}

/** Bornes de la ligne qui contient `position`. */
function lineBounds(text: string, position: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const end = text.indexOf('\n', position)
  return { start, end: end === -1 ? text.length : end }
}

/**
 * Étend une sélection vide au mot sous le curseur.
 *
 * Sans cela, appuyer sur « gras » sans rien avoir sélectionné posait deux paires
 * d'astérisques autour du vide — le geste le plus naturel, écrire un mot puis le
 * mettre en gras, ne marchait pas.
 */
function widenToWord(text: string, selection: Selection): Selection {
  if (selection.start !== selection.end) return selection
  const isWord = (c: string) => c !== undefined && /[^\s*_~[\]()]/.test(c)

  let start = selection.start
  let end = selection.end
  while (start > 0 && isWord(text[start - 1])) start--
  while (end < text.length && isWord(text[end])) end++
  return { start, end }
}

/**
 * Applique une commande de mise en forme.
 *
 * Fonction pure, et c'est délibéré : c'est ici que se cachent les fautes d'index
 * qui décalent tout le texte d'un caractère, et elles se testent bien plus
 * facilement qu'à travers un champ de saisie.
 *
 * Les commandes de bloc — puce, titre, sous-titre — basculent : réappuyer sur
 * « titre » sur une ligne qui en est déjà un la ramène en texte courant, plutôt
 * que d'empiler les dièses.
 */
export function applyFormat(text: string, selection: Selection, format: Format): Edit {
  if (format === 'bullet' || format === 'title' || format === 'subtitle') {
    const { start } = lineBounds(text, selection.start)
    const line = text.slice(start)
    const prefix = PREFIXES[format]

    // Une ligne ne porte qu'une marque de bloc : passer de titre à puce retire
    // le dièse au lieu de préfixer une ligne déjà préfixée.
    const existing = ['## ', '# ', '- ', '• '].find((p) => line.startsWith(p))
    const removed = existing ? existing.length : 0
    const toggling = existing === prefix

    const next =
      text.slice(0, start) + (toggling ? '' : prefix) + text.slice(start + removed)
    const shift = (toggling ? 0 : prefix.length) - removed
    return {
      text: next,
      selection: {
        start: Math.max(start, selection.start + shift),
        end: Math.max(start, selection.end + shift),
      },
    }
  }

  const wrapper = WRAPPERS[format]
  const target = widenToWord(text, selection)
  const before = text.slice(0, target.start)
  const inner = text.slice(target.start, target.end)
  const after = text.slice(target.end)

  // Retirer la marque plutôt que la doubler quand elle est déjà là.
  if (before.endsWith(wrapper) && after.startsWith(wrapper)) {
    const next = before.slice(0, -wrapper.length) + inner + after.slice(wrapper.length)
    return {
      text: next,
      selection: {
        start: target.start - wrapper.length,
        end: target.end - wrapper.length,
      },
    }
  }

  const next = `${before}${wrapper}${inner}${wrapper}${after}`
  return {
    text: next,
    // Le curseur se pose entre les marques quand il n'y avait rien à envelopper,
    // pour qu'on puisse écrire dans la foulée.
    selection: {
      start: target.start + wrapper.length,
      end: target.end + wrapper.length,
    },
  }
}

/**
 * Insère un lien, en réutilisant la sélection comme libellé.
 *
 * L'adresse est laissée à remplir plutôt que demandée dans une boîte de
 * dialogue : sur un téléphone, une invite modale par-dessus le clavier coûte
 * plus cher que de taper l'adresse là où elle ira.
 */
export function insertLink(text: string, selection: Selection): Edit {
  const target = widenToWord(text, selection)
  const label = text.slice(target.start, target.end) || 'libellé'
  const inserted = `[${label}]()`
  return {
    text: text.slice(0, target.start) + inserted + text.slice(target.end),
    // Curseur entre les parenthèses, là où l'adresse doit être collée.
    selection: {
      start: target.start + inserted.length - 1,
      end: target.start + inserted.length - 1,
    },
  }
}
